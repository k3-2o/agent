// P6 · Sleep/wake — idle kill, wake replay, queued wake requests.
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

const INIT_PARAMS = { processId: null, rootUri: "file:///sleep", capabilities: {} };
const uriA = "file:///sleep/a.ts";
const didOpenParams = (uri: string, text: string) => ({
  textDocument: { uri, languageId: "typescript", version: 1, text },
});
const diagParams = (uri: string) => ({ textDocument: { uri } });

test("W1 idle sleep SIGTERMs the child and logs", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      const clock = new FakeClock();
      await withWarden(dir, ["--sleep-after", "2"], clock, async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
        await c.receive(); // last real activity at t=0
        await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
        await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA, "text1") });
        const pid1 = startPids(fakeLog(dir)())[0];

        await clock.tick(4000); // sleep-after 2 s exceeded; sleep check must catch it
        await waitFor(() => !alive(pid1));
        await waitFor(() => fakeLog(dir)().some((e) => e.ev === "sigterm"));
        expect(wardenLog(dir)().some((e) => e.ev === "sleep")).toBe(true);
      });
    });
  } finally {
    rmdir(dir);
  }
});

test("W2 wake replays opens then answers the waking request", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      const clock = new FakeClock();
      await withWarden(dir, ["--sleep-after", "2"], clock, async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
        await c.receive();
        await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
        await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA, "text1") });
        const pid1 = startPids(fakeLog(dir)())[0];

        await clock.tick(4000);
        await waitFor(() => !alive(pid1));
        expect(wardenLog(dir)().some((e) => e.ev === "sleep")).toBe(true);

        const params = diagParams(uriA);
        await c.send({ jsonrpc: "2.0", id: 30, method: "textDocument/diagnostic", params });
        const resp = await c.receive();
        expect(resp.id).toBe(30);
        expect(resp.result).toEqual({ ok: true, echoMethod: "textDocument/diagnostic", echoParams: params });

        await waitFor(() => recvs(fakeLog(dir)()).filter((e) => e.method === "textDocument/diagnostic").length === 1);
        await settle(100);
        expect(startPids(fakeLog(dir)())).toHaveLength(2); // exactly one wake spawn
        // Counts: client messages forwarded verbatim + replay; ordering pin:
        // the waking diagnostic reaches the fresh child AFTER its replay.
        const methods = recvs(fakeLog(dir)()).map((e) => e.method);
        expect(methods.filter((x) => x === "initialize")).toHaveLength(2);
        expect(methods.filter((x) => x === "textDocument/didOpen")).toHaveLength(2);
        expect(methods.filter((x) => x === "textDocument/diagnostic")).toHaveLength(1);
        expect(methods.lastIndexOf("initialize")).toBeLessThan(methods.lastIndexOf("textDocument/didOpen"));
        expect(methods.lastIndexOf("textDocument/didOpen")).toBeLessThan(methods.indexOf("textDocument/diagnostic"));
        expect(wardenLog(dir)().some((e) => e.ev === "wake")).toBe(true);
      });
    });
  } finally {
    rmdir(dir);
  }
});

test("W3 requests queue during wake and are answered in order", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      const clock = new FakeClock();
      await withWarden(dir, ["--sleep-after", "2"], clock, async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
        await c.receive();
        await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
        await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA, "text1") });

        await clock.tick(4000);
        await waitFor(() => wardenLog(dir)().some((e) => e.ev === "sleep"));

        const p1 = diagParams(uriA);
        const p2 = { textDocument: { uri: uriA }, range: { start: { line: 0, character: 0 } } };
        await c.send({ jsonrpc: "2.0", id: 41, method: "textDocument/diagnostic", params: p1 });
        await c.send({ jsonrpc: "2.0", id: 42, method: "textDocument/diagnostic", params: p2 });
        const r1 = await c.receive();
        const r2 = await c.receive();
        expect(r1.id).toBe(41);
        expect(r2.id).toBe(42);
        expect(r1.result).toEqual({ ok: true, echoMethod: "textDocument/diagnostic", echoParams: p1 });
        expect(r2.result).toEqual({ ok: true, echoMethod: "textDocument/diagnostic", echoParams: p2 });

        await settle(100);
        expect(startPids(fakeLog(dir)())).toHaveLength(2); // ONE wake for both
        const diags = recvs(fakeLog(dir)()).filter((e) => e.method === "textDocument/diagnostic");
        expect(diags.map((e) => e.params)).toEqual([p1, p2]); // in send order
      });
    });
  } finally {
    rmdir(dir);
  }
});

test("W4 --sleep-after 0 disables sleeping", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      const clock = new FakeClock();
      await withWarden(dir, ["--sleep-after", "0"], clock, async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
        await c.receive();
        await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
        await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA, "text1") });
        const pid1 = startPids(fakeLog(dir)())[0];

        await clock.tick(60000); // far past even the 15 s sweeper
        expect(alive(pid1)).toBe(true);
        expect(wardenLog(dir)().filter((e) => e.ev === "sleep" || e.ev === "crash")).toHaveLength(0);
      });
    });
  } finally {
    rmdir(dir);
  }
});

test("W5 $-methods don't count as activity for sleep", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      const clock = new FakeClock();
      await withWarden(dir, ["--sleep-after", "10"], clock, async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
        await c.receive(); // last REAL activity at t=0 → sleep deadline 10 s
        await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
        await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA, "text1") });
        const pid1 = startPids(fakeLog(dir)())[0];

        await clock.tick(8000);
        await c.send({ jsonrpc: "2.0", method: "$/setTrace", params: { value: "verbose" } });
        await waitFor(() => recvs(fakeLog(dir)()).some((e) => e.method === "$/setTrace"));
        await clock.tick(6000); // t=14 s: BEFORE the $/setTrace deadline (18 s)

        // If $/setTrace had counted, the child would still be alive at 14 s.
        await waitFor(() => !alive(pid1));
        expect(wardenLog(dir)().some((e) => e.ev === "sleep")).toBe(true);
        expect(fakeLog(dir)().some((e) => e.ev === "sigterm")).toBe(true);
      });
    });
  } finally {
    rmdir(dir);
  }
});