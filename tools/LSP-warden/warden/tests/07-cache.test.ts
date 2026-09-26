// P7 · Cache — diagnostics cache: asleep-only, hash-gated, never-list.
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

const INIT_PARAMS = { processId: null, rootUri: "file:///cache", capabilities: {} };
const uriA = "file:///cache/a.ts";
const didOpenParams = (uri: string, text: string) => ({
  textDocument: { uri, languageId: "typescript", version: 1, text },
});
const didChangeParams = (uri: string, text: string) => ({
  textDocument: { uri, version: 2 },
  contentChanges: [{ text }],
});
const diagParams = (uri: string) => ({ textDocument: { uri } });
const refParams = (uri: string) => ({
  textDocument: { uri },
  position: { line: 0, character: 0 },
  context: { includeDeclaration: true },
});

test("C1 cache hit while asleep: same text, no spawn", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      const clock = new FakeClock();
      await withWarden(dir, ["--sleep-after", "2"], clock, async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
        await c.receive();
        await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
        await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA, "T1") });
        await c.send({ jsonrpc: "2.0", id: 21, method: "textDocument/diagnostic", params: diagParams(uriA) });
        const live = await c.receive();
        expect(live.id).toBe(21);
        const liveResult = live.result;

        await clock.tick(4000); // child sleeps
        await waitFor(() => wardenLog(dir)().some((e) => e.ev === "sleep"));

        // Same URI, unchanged text, child asleep → answer from cache.
        await c.send({ jsonrpc: "2.0", id: 22, method: "textDocument/diagnostic", params: diagParams(uriA) });
        const cached = await c.receive();
        expect(cached.id).toBe(22);
        expect(cached.result).toEqual(liveResult); // deep-equal cached report
        await settle(150);
        expect(startPids(fakeLog(dir)())).toHaveLength(1); // NO spawn
        expect(recvs(fakeLog(dir)()).filter((e) => e.method === "textDocument/diagnostic")).toHaveLength(1);
      });
    });
  } finally {
    rmdir(dir);
  }
});

test("C2 hash change forces a live answer (wake + replay)", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      const clock = new FakeClock();
      await withWarden(dir, ["--sleep-after", "2"], clock, async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
        await c.receive();
        await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
        await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA, "T1") });
        await c.send({ jsonrpc: "2.0", id: 23, method: "textDocument/diagnostic", params: diagParams(uriA) });
        await c.receive();

        await clock.tick(4000);
        await waitFor(() => wardenLog(dir)().some((e) => e.ev === "sleep"));

        // Text changes while asleep: registry updates, dead child gets nothing.
        await c.send({ jsonrpc: "2.0", method: "textDocument/didChange", params: didChangeParams(uriA, "T2") });
        await settle(150);
        expect(recvs(fakeLog(dir)()).filter((e) => e.method === "textDocument/didChange")).toHaveLength(0);

        // Different hash → cache cannot serve → wake + forward.
        await c.send({ jsonrpc: "2.0", id: 24, method: "textDocument/diagnostic", params: diagParams(uriA) });
        const resp = await c.receive();
        expect(resp.id).toBe(24);
        expect(resp.result).toEqual({ ok: true, echoMethod: "textDocument/diagnostic", echoParams: diagParams(uriA) });

        await waitFor(() => startPids(fakeLog(dir)()).length === 2);
        await settle(100);
        expect(wardenLog(dir)().some((e) => e.ev === "wake")).toBe(true);
        const log = fakeLog(dir)();
        // Replay carries the CURRENT registry text (T2), and the diagnostic
        // arrived AFTER the replay.
        const opens = recvs(log).filter((e) => e.method === "textDocument/didOpen");
        expect(opens.map((e) => e.params)).toEqual([didOpenParams(uriA, "T1"), didOpenParams(uriA, "T2")]);
        const diags = recvs(log).filter((e) => e.method === "textDocument/diagnostic");
        expect(diags).toHaveLength(2);
      });
    });
  } finally {
    rmdir(dir);
  }
});

test("C3 awake child is never cache-served (both requests forwarded)", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      await withWarden(dir, ["--sleep-after", "2"], new FakeClock(), async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
        await c.receive();
        await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
        await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA, "T1") });
        await c.send({ jsonrpc: "2.0", id: 25, method: "textDocument/diagnostic", params: diagParams(uriA) });
        await c.receive();

        await c.send({ jsonrpc: "2.0", id: 26, method: "textDocument/diagnostic", params: diagParams(uriA) });
        const resp = await c.receive();
        expect(resp.id).toBe(26);
        expect(resp.result).toEqual({ ok: true, echoMethod: "textDocument/diagnostic", echoParams: diagParams(uriA) });

        await settle(150);
        expect(startPids(fakeLog(dir)())).toHaveLength(1); // never slept, never spawned
        expect(recvs(fakeLog(dir)()).filter((e) => e.method === "textDocument/diagnostic")).toHaveLength(2);
      });
    });
  } finally {
    rmdir(dir);
  }
});

test("C4 type-truth methods are never served from cache", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      const clock = new FakeClock();
      await withWarden(dir, ["--sleep-after", "2"], clock, async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
        await c.receive();
        await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
        await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA, "T1") });
        await c.send({ jsonrpc: "2.0", id: 27, method: "textDocument/references", params: refParams(uriA) });
        await c.receive();

        await clock.tick(4000);
        await waitFor(() => wardenLog(dir)().some((e) => e.ev === "sleep"));

        // references is on the never-cache line: asleep or not, it wakes the
        // child and hits the live server.
        await c.send({ jsonrpc: "2.0", id: 28, method: "textDocument/references", params: refParams(uriA) });
        const resp = await c.receive();
        expect(resp.id).toBe(28);
        expect(resp.result).toEqual({ ok: true, echoMethod: "textDocument/references", echoParams: refParams(uriA) });
        expect(resp.error).toBeUndefined(); // never a -32026 short-circuit

        await waitFor(() => startPids(fakeLog(dir)()).length === 2);
        await settle(100);
        expect(recvs(fakeLog(dir)()).filter((e) => e.method === "textDocument/references")).toHaveLength(2);
      });
    });
  } finally {
    rmdir(dir);
  }
});