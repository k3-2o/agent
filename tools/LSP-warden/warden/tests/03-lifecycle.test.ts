// P3 · Lifecycle — initialize cache, repeat-initialize, upsert, expected exit.
// The keystone: every child-killing feature later assumes these rules.
// Frozen-red until `warden/warden.ts` exists.
import { test, expect } from "bun:test";
import { join } from "node:path";
import { createWarden, type WardenHandle } from "../warden";
import { FakeClock } from "./harness/clock";
import { FrameClient } from "./harness/client";
import {
  fakeServerPath,
  tmpdir,
  rmdir,
  readLog,
  waitFor,
  withEnv,
  settle,
  alive,
  recvs,
  startPids,
} from "./harness/util";

async function withWarden(
  dir: string,
  extraFlags: string[],
  clock: FakeClock,
  fn: (w: WardenHandle) => Promise<void>,
): Promise<void> {
  const w = await createWarden(
    ["--log", join(dir, "warden.jsonl"), ...extraFlags, "--", "bun", fakeServerPath],
    { clock },
  );
  try {
    await fn(w);
  } finally {
    await w.dispose();
  }
}

const fakeLog = (dir: string) => () => readLog(join(dir, "fake.jsonl"));
const wardenLog = (dir: string) => () => readLog(join(dir, "warden.jsonl"));

const INIT_PARAMS = { processId: null, rootUri: "file:///lifecycle", capabilities: {} };

function didOpenParams(uri: string, text: string): { textDocument: Record<string, unknown> } {
  return { textDocument: { uri, languageId: "typescript", version: 1, text } };
}

test("L1 repeat initialize answered from cache (never forwarded)", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      await withWarden(dir, [], new FakeClock(), async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
        const first = await c.receive();
        expect(first.id).toBe(1);
        await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
        await c.send({
          jsonrpc: "2.0",
          method: "textDocument/didOpen",
          params: didOpenParams("file:///l1/a.ts", "text1"),
        });

        await c.send({ jsonrpc: "2.0", id: 2, method: "initialize", params: INIT_PARAMS });
        const second = await c.receive();
        expect(second.id).toBe(2);
        expect(second.result).toEqual(first.result); // identical cached result

        await settle(100);
        expect(recvs(fakeLog(dir)()).filter((e) => e.method === "initialize")).toHaveLength(1);
      });
    });
  } finally {
    rmdir(dir);
  }
});

test("L2 initialized forwarded after a cache-served initialize", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      await withWarden(dir, [], new FakeClock(), async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
        await c.receive();
        await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
        await c.send({ jsonrpc: "2.0", id: 2, method: "initialize", params: INIT_PARAMS });
        await c.receive(); // served from cache
        await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
        await waitFor(() => recvs(fakeLog(dir)()).filter((e) => e.method === "initialized").length === 2);
        const log = fakeLog(dir)();
        expect(recvs(log).filter((e) => e.method === "initialized")).toHaveLength(2);
        expect(recvs(log).filter((e) => e.method === "initialize")).toHaveLength(1);
      });
    });
  } finally {
    rmdir(dir);
  }
});

test("L3 duplicate didOpen is an upsert (forwarded verbatim, lease reset)", async () => {
  const dir = tmpdir();
  const uriA = "file:///l3/a.ts";
  const uriC = "file:///l3/c.ts";
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      const clock = new FakeClock();
      await withWarden(dir, ["--idle-secs", "10"], clock, async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
        await c.receive();
        await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
        await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA, "text1") });
        await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriC, "textC") });

        await clock.tick(8000); // 8 s later the SAME file is opened again
        await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA, "text2") });
        await clock.tick(8000); // sweeper fires at 15 s

        // Both didOpens for A were forwarded verbatim, in order.
        await waitFor(() => recvs(fakeLog(dir)()).filter((e) => e.method === "textDocument/didOpen").length === 3);
        const opens = recvs(fakeLog(dir)()).filter((e) => e.method === "textDocument/didOpen");
        expect(opens.map((e) => e.params)).toEqual([
          didOpenParams(uriA, "text1"),
          didOpenParams(uriC, "textC"),
          didOpenParams(uriA, "text2"),
        ]);

        // A's lease was RESET by the duplicate open → survives the 15 s sweep
        // (age since the dup = 7 s < idle 10 s). C (no dup) is swept.
        await waitFor(() => recvs(fakeLog(dir)()).some((e) => e.method === "textDocument/didClose"));
        await settle(100);
        const closes = recvs(fakeLog(dir)()).filter((e) => e.method === "textDocument/didClose");
        expect(closes).toHaveLength(1);
        expect(closes[0].id).toBeUndefined();
        expect(closes[0].params).toEqual({ textDocument: { uri: uriC } });
        expect(wardenLog(dir)().find((e) => e.ev === "close")?.uri).toBe(uriC);
      });
    });
  } finally {
    rmdir(dir);
  }
});

test("L4 expected shutdown+exit is not a crash; registry retained", async () => {
  const dir = tmpdir();
  const uriA = "file:///l4/a.ts";
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      await withWarden(dir, [], new FakeClock(), async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
        await c.receive();
        await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
        await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA, "text1") });
        const pid1 = startPids(fakeLog(dir)())[0];

        await c.send({ jsonrpc: "2.0", id: 9, method: "shutdown" });
        const shutdownResp = await c.receive();
        expect(shutdownResp.id).toBe(9);
        await c.send({ jsonrpc: "2.0", method: "exit" });

        await waitFor(() => !alive(pid1));
        await waitFor(() => fakeLog(dir)().some((e) => e.ev === "sigterm"));
        expect(wardenLog(dir)().filter((e) => e.ev === "crash")).toHaveLength(0);

        // Next request wakes a fresh child which replays the open.
        await c.send({
          jsonrpc: "2.0",
          id: 10,
          method: "textDocument/hover",
          params: { textDocument: { uri: uriA }, position: { line: 0, character: 0 } },
        });
        const resp = await c.receive();
        expect(resp.id).toBe(10);
        await waitFor(() => startPids(fakeLog(dir)()).length === 2);
        await settle(100);
        // Every client message is forwarded verbatim (initialize, initialized,
        // didOpen, shutdown, exit), then the wake replays (initialize, didOpen)
        // and answers the hover — assert counts plus the load-bearing order:
        // shutdown+exit hit child 1 before the expected-exit kill, and the
        // fresh child's replay (initialize, didOpen) precedes the hover.
        const methods = recvs(fakeLog(dir)()).map((e) => e.method);
        expect(methods.filter((x) => x === "initialize")).toHaveLength(2);
        expect(methods.filter((x) => x === "initialized")).toHaveLength(2); // client's + warden's post-restart
        expect(methods.filter((x) => x === "textDocument/didOpen")).toHaveLength(2);
        expect(methods.filter((x) => x === "shutdown")).toHaveLength(1);
        expect(methods.filter((x) => x === "exit")).toHaveLength(1);
        expect(methods.filter((x) => x === "textDocument/hover")).toHaveLength(1);
        expect(methods.indexOf("shutdown")).toBeLessThan(methods.indexOf("exit"));
        expect(methods.indexOf("exit")).toBeLessThan(methods.lastIndexOf("initialize"));
        expect(methods.lastIndexOf("initialize")).toBeLessThan(methods.lastIndexOf("textDocument/didOpen"));
        expect(methods.lastIndexOf("textDocument/didOpen")).toBeLessThan(methods.indexOf("textDocument/hover"));
      });
    });
  } finally {
    rmdir(dir);
  }
});

test("L5 initialize cache survives a budget restart (stale capabilities accepted)", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      const clock = new FakeClock();
      // pidReader is a closure: `pid1` is assigned after the child spawns,
      // before the first sample at fake t=1 s.
      let pid1 = 0;
      let over = true;
      const pidReader = (pid: number): number | undefined => {
        return pid === pid1 && over ? 600_000 : 100_000;
      };
      const w = await createWarden(
        [
          "--log",
          join(dir, "warden.jsonl"),
          "--budget-mb",
          "512",
          "--sample-secs",
          "1",
          "--sustain",
          "1",
          "--",
          "bun",
          fakeServerPath,
        ],
        { clock, pidReader },
      );
      try {
        const c = new FrameClient(w.clientIn, w.clientOut);
        await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
        const first = await c.receive();
        pid1 = startPids(fakeLog(dir)())[0];
        await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
        await c.send({
          jsonrpc: "2.0",
          method: "textDocument/didOpen",
          params: didOpenParams("file:///l5/a.ts", "text1"),
        });

        await clock.tick(1500); // sample @1 s → over budget → restart
        await waitFor(() => startPids(fakeLog(dir)()).length === 2);
        over = false;

        // A NEW logical client initializes over the same daemon.
        await c.send({ jsonrpc: "2.0", id: 2, method: "initialize", params: INIT_PARAMS });
        const second = await c.receive();
        expect(second.id).toBe(2);
        expect(second.result).toEqual(first.result); // FIRST child's fakeMarker

        await settle(100);
        const log = fakeLog(dir)();
        expect(recvs(log).filter((e) => e.method === "initialize")).toHaveLength(2); // one per child
        expect(recvs(log).filter((e) => e.method === "textDocument/didOpen")).toHaveLength(2); // replay
      } finally {
        await w.dispose();
      }
    });
  } finally {
    rmdir(dir);
  }
});