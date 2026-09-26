// P5 · Budget — sampler, restart-with-replay, drain deadline, crash loop.
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
  recvs,
  startPids,
} from "./harness/util";

async function withWarden(
  dir: string,
  extraFlags: string[],
  clock: FakeClock,
  pidReader: ((pid: number) => number | undefined) | undefined,
  fn: (w: WardenHandle) => Promise<void>,
): Promise<void> {
  const w = await createWarden(
    ["--log", join(dir, "warden.jsonl"), ...extraFlags, "--", "bun", fakeServerPath],
    { clock, ...(pidReader ? { pidReader } : {}) },
  );
  try {
    await fn(w);
  } finally {
    await w.dispose();
  }
}

const fakeLog = (dir: string) => () => readLog(join(dir, "fake.jsonl"));
const wardenLog = (dir: string) => () => readLog(join(dir, "warden.jsonl"));

const INIT_PARAMS = { processId: null, rootUri: "file:///restart", capabilities: {} };
const uriA = "file:///restart/a.ts";
const didOpenParams = (uri: string, text: string) => ({
  textDocument: { uri, languageId: "typescript", version: 1, text },
});
const didChangeParams = (uri: string, text: string) => ({
  textDocument: { uri, version: 2 },
  contentChanges: [{ text }],
});

test("R1 budget restart replays opens with current registry text", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      const clock = new FakeClock();
      let pid1 = 0;
      const pidReader = (pid: number): number | undefined => (pid === pid1 ? 600_000 : 100_000);
      await withWarden(
        dir,
        ["--budget-mb", "512", "--sample-secs", "1", "--sustain", "2"],
        clock,
        pidReader,
        async (w) => {
          const c = new FrameClient(w.clientIn, w.clientOut);
          await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
          await c.receive();
          pid1 = startPids(fakeLog(dir)())[0];
          await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
          await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA, "text1") });
          await c.send({ jsonrpc: "2.0", method: "textDocument/didChange", params: didChangeParams(uriA, "text2") });
          await waitFor(() => recvs(fakeLog(dir)()).some((e) => e.method === "textDocument/didChange"));

          // Samples @1 s (600→1) and @2 s (600→2 ≥ sustain) → restart.
          await clock.tick(3500);
          await waitFor(() => startPids(fakeLog(dir)()).length === 2);
          await settle(100);

          const log = fakeLog(dir)();
          const initRecvs = recvs(log).filter((e) => e.method === "initialize");
          expect(initRecvs).toHaveLength(2); // original + restart re-initialize
          expect(initRecvs.map((e) => e.params)).toEqual([INIT_PARAMS, INIT_PARAMS]); // cached params
          const openRecvs = recvs(log).filter((e) => e.method === "textDocument/didOpen");
          expect(openRecvs.map((e) => e.params)).toEqual([
            didOpenParams(uriA, "text1"),
            didOpenParams(uriA, "text2"), // replay carries the CURRENT text, not a replayed diff
          ]);
          expect(recvs(log).filter((e) => e.method === "textDocument/didChange")).toHaveLength(1);
          expect(log.some((e) => e.ev === "sigterm")).toBe(true);
          expect(wardenLog(dir)().some((e) => e.ev === "restart" && e.reason === "budget")).toBe(true);

          // Healthy after restart.
          await c.send({
            jsonrpc: "2.0",
            id: 5,
            method: "textDocument/hover",
            params: { textDocument: { uri: uriA }, position: { line: 0, character: 0 } },
          });
          const resp = await c.receive();
          expect(resp.id).toBe(5);
        },
      );
    });
  } finally {
    rmdir(dir);
  }
});

test("R2 sustain counter resets under budget (no restart flap)", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      const clock = new FakeClock();
      let samples = 0;
      const pidReader = (pid: number): number | undefined => {
        samples++;
        return samples === 2 ? 100_000 : 600_000; // over, under, over (kB; budget 512 MB)
      };
      await withWarden(
        dir,
        ["--budget-mb", "512", "--sample-secs", "1", "--sustain", "2"],
        clock,
        pidReader,
        async (w) => {
          const c = new FrameClient(w.clientIn, w.clientOut);
          await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
          await c.receive();
          await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
          await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA, "text1") });

          await clock.tick(3500); // 3 samples: over, under, over — never sustained
          await settle(150);
          expect(startPids(fakeLog(dir)())).toHaveLength(1);
          expect(wardenLog(dir)().filter((e) => e.ev === "restart")).toHaveLength(0);
        },
      );
    });
  } finally {
    rmdir(dir);
  }
});

test("R3 drain deadline answers a held request honestly (-32026, no hang)", async () => {
  const dir = tmpdir();
  try {
    await withEnv(
      {
        WARDEN_TEST_FAKE: JSON.stringify({ hold: ["textDocument/diagnostic"] }),
        WARDEN_TEST_LOG: join(dir, "fake.jsonl"),
      },
      async () => {
        const clock = new FakeClock();
        let pid1 = 0;
        const pidReader = (pid: number): number | undefined => (pid === pid1 ? 600_000 : 100_000);
        await withWarden(
          dir,
          ["--budget-mb", "512", "--sample-secs", "1", "--sustain", "1"],
          clock,
          pidReader,
          async (w) => {
            const c = new FrameClient(w.clientIn, w.clientOut);
            await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
            await c.receive();
            pid1 = startPids(fakeLog(dir)())[0];
            await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
            await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA, "text1") });

            // The diagnostic is in flight and held at the server when the
            // budget restart begins. The 3 s drain deadline must kill it
            // honestly instead of hanging the client.
            await c.send({
              jsonrpc: "2.0",
              id: 20,
              method: "textDocument/diagnostic",
              params: { textDocument: { uri: uriA } },
            });
            await waitFor(() => recvs(fakeLog(dir)()).some((e) => e.method === "textDocument/diagnostic"));

            await clock.tick(5000); // sample @1 s → restart; drain deadline @4 s
            const err = await c.receive();
            expect(err.id).toBe(20);
            expect(err.error).toEqual({ code: -32026, message: "lsp-warden: child unavailable" });
            expect(err.result).toBeUndefined();

            await waitFor(() => startPids(fakeLog(dir)()).length === 2);
            expect(wardenLog(dir)().some((e) => e.ev === "restart" && e.reason === "budget")).toBe(true);
            // Held request never leaked a partial answer to the client.
            await c.send({
              jsonrpc: "2.0",
              id: 21,
              method: "textDocument/hover",
              params: { textDocument: { uri: uriA }, position: { line: 0, character: 0 } },
            });
            const resp = await c.receive();
            expect(resp.id).toBe(21);
          },
        );
      },
    );
  } finally {
    rmdir(dir);
  }
});

test("R4 crash-loop guard: 3 deaths → dead, errors not hangs", async () => {
  const dir = tmpdir();
  try {
    await withEnv(
      {
        WARDEN_TEST_FAKE: JSON.stringify({ dieOn: "initialize" }),
        WARDEN_TEST_LOG: join(dir, "fake.jsonl"),
      },
      async () => {
        await withWarden(dir, [], new FakeClock(), undefined, async (w) => {
          const c = new FrameClient(w.clientIn, w.clientOut);

          await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
          await waitFor(() => startPids(fakeLog(dir)()).length === 3);
          const initErr = await c.receive();
          expect(initErr.id).toBe(1);
          expect(initErr.error).toEqual({ code: -32026, message: "lsp-warden: child unavailable" });

          // Fourth request: answered with an error, NO fourth spawn.
          await c.send({
            jsonrpc: "2.0",
            id: 2,
            method: "textDocument/hover",
            params: { textDocument: { uri: uriA }, position: { line: 0, character: 0 } },
          });
          const hoverErr = await c.receive();
          expect(hoverErr.id).toBe(2);
          expect(hoverErr.error).toEqual({ code: -32026, message: "lsp-warden: child unavailable" });
          await settle(200);
          expect(startPids(fakeLog(dir)())).toHaveLength(3);
          expect(recvs(fakeLog(dir)()).filter((e) => e.method === "initialize")).toHaveLength(3);
          expect(wardenLog(dir)().filter((e) => e.ev === "crash")).toHaveLength(3);
        });
      },
    );
  } finally {
    rmdir(dir);
  }
});

test("R5 unexpected crash restarts with replay; next request works", async () => {
  const dir = tmpdir();
  try {
    await withEnv(
      {
        WARDEN_TEST_FAKE: JSON.stringify({ dieOn: "textDocument/didChange" }),
        WARDEN_TEST_LOG: join(dir, "fake.jsonl"),
      },
      async () => {
        await withWarden(dir, [], new FakeClock(), undefined, async (w) => {
          const c = new FrameClient(w.clientIn, w.clientOut);
          await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
          await c.receive();
          await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
          await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA, "text1") });
          await waitFor(() => recvs(fakeLog(dir)()).some((e) => e.method === "textDocument/didOpen"));

          // didChange kills the child mid-session → unexpected exit → restart.
          await c.send({ jsonrpc: "2.0", method: "textDocument/didChange", params: didChangeParams(uriA, "text2") });
          await waitFor(() => startPids(fakeLog(dir)()).length === 2);
          await settle(100);

          expect(wardenLog(dir)().some((e) => e.ev === "restart" && e.reason === "crash")).toBe(true);
          const log = fakeLog(dir)();
          expect(recvs(log).filter((e) => e.method === "initialize")).toHaveLength(2);
          expect(recvs(log).filter((e) => e.method === "textDocument/didChange")).toHaveLength(1);
          const opens = recvs(log).filter((e) => e.method === "textDocument/didOpen");
          expect(opens.map((e) => e.params)).toEqual([
            didOpenParams(uriA, "text1"),
            didOpenParams(uriA, "text2"), // replay uses the registry's CURRENT text
          ]);

          await c.send({
            jsonrpc: "2.0",
            id: 7,
            method: "textDocument/hover",
            params: { textDocument: { uri: uriA }, position: { line: 0, character: 0 } },
          });
          const resp = await c.receive();
          expect(resp.id).toBe(7);
          expect(recvs(fakeLog(dir)()).filter((e) => e.method === "textDocument/hover")).toHaveLength(1);
        });
      },
    );
  } finally {
    rmdir(dir);
  }
});