// P4 · Leases — registry + 15 s sweeper. Frozen-red until `warden/warden.ts`.
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

const INIT_PARAMS = { processId: null, rootUri: "file:///lease", capabilities: {} };
const uriA = "file:///lease/a.ts";
const uriB = "file:///lease/b.ts";
const didOpenParams = (uri: string) => ({
  textDocument: { uri, languageId: "typescript", version: 1, text: `text of ${uri}` },
});
const didCloseParams = (uri: string) => ({ textDocument: { uri } });

test("S1 idle file closed by the sweeper", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      const clock = new FakeClock();
      await withWarden(dir, ["--idle-secs", "1"], clock, async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
        await c.receive();
        await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
        await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA) });

        await clock.tick(16000); // sweeper fires at 15 s; idle 1 s exceeded long before
        await waitFor(() => recvs(fakeLog(dir)()).some((e) => e.method === "textDocument/didClose"));
        const close = recvs(fakeLog(dir)()).find((e) => e.method === "textDocument/didClose")!;
        expect(close.id).toBeUndefined(); // warden-initiated notification: no id
        expect(close.params).toEqual(didCloseParams(uriA));
        expect(wardenLog(dir)().find((e) => e.ev === "close")?.uri).toBe(uriA);
      });
    });
  } finally {
    rmdir(dir);
  }
});

test("S2 in-flight request protects the file from sweeping", async () => {
  const dir = tmpdir();
  try {
    await withEnv(
      {
        WARDEN_TEST_FAKE: JSON.stringify({ hold: ["textDocument/diagnostic"] }),
        WARDEN_TEST_LOG: join(dir, "fake.jsonl"),
      },
      async () => {
        const clock = new FakeClock();
        await withWarden(dir, ["--idle-secs", "1"], clock, async (w) => {
          const c = new FrameClient(w.clientIn, w.clientOut);
          await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
          await c.receive();
          await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
          await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriB) });

          // Diagnostic on B is held at the server → in flight through the sweep.
          await c.send({
            jsonrpc: "2.0",
            id: 11,
            method: "textDocument/diagnostic",
            params: { textDocument: { uri: uriB } },
          });
          await waitFor(() =>
            recvs(fakeLog(dir)()).some((e) => e.method === "textDocument/diagnostic"),
          );
          await clock.tick(16000); // sweep at 15 s MUST skip B
          await settle(100);
          expect(recvs(fakeLog(dir)()).filter((e) => e.method === "textDocument/didClose")).toHaveLength(0);
          expect(wardenLog(dir)().filter((e) => e.ev === "close")).toHaveLength(0);

          // Release; the next sweep sees B idle and closes it.
          await c.send({ jsonrpc: "2.0", method: "$/fake/release" });
          const resp = await c.receive();
          expect(resp.id).toBe(11);
          await clock.tick(16000); // sweep at 30 s
          await waitFor(() => recvs(fakeLog(dir)()).some((e) => e.method === "textDocument/didClose"));
          const close = recvs(fakeLog(dir)()).find((e) => e.method === "textDocument/didClose")!;
          expect(close.params).toEqual(didCloseParams(uriB));
        });
      },
    );
  } finally {
    rmdir(dir);
  }
});

test("S3 client didClose removes the entry (no duplicate close)", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      const clock = new FakeClock();
      await withWarden(dir, ["--idle-secs", "1"], clock, async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
        await c.receive();
        await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
        await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA) });
        await c.send({ jsonrpc: "2.0", method: "textDocument/didClose", params: didCloseParams(uriA) });
        await waitFor(() => recvs(fakeLog(dir)()).some((e) => e.method === "textDocument/didClose"));

        await clock.tick(16000); // sweep — nothing left to close
        await settle(100);
        expect(recvs(fakeLog(dir)()).filter((e) => e.method === "textDocument/didClose")).toHaveLength(1);
        expect(wardenLog(dir)().filter((e) => e.ev === "close")).toHaveLength(0);
      });
    });
  } finally {
    rmdir(dir);
  }
});

test("S4 $-methods are not activity for the lease", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      const clock = new FakeClock();
      await withWarden(dir, ["--idle-secs", "10"], clock, async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
        await c.receive();
        await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
        await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA) });

        await clock.tick(8000);
        // A $-prefixed notification CARRYING the file's uri exercises per-uri
        // lease activity: if $-methods counted as activity, A's lease would
        // reset at t=8 s and it would survive the 15 s sweep. It is swept →
        // $-methods never touch the lease.
        await c.send({
          jsonrpc: "2.0",
          method: "$/private/touch",
          params: { textDocument: { uri: uriA } },
        });
        await waitFor(() => recvs(fakeLog(dir)()).some((e) => e.method === "$/private/touch"));
        await clock.tick(8000); // sweep at 15 s

        await waitFor(() => recvs(fakeLog(dir)()).some((e) => e.method === "textDocument/didClose"));
        expect(recvs(fakeLog(dir)()).filter((e) => e.method === "textDocument/didClose")).toHaveLength(1);
        expect(startPids(fakeLog(dir)())).toHaveLength(1); // no spawn happened
      });
    });
  } finally {
    rmdir(dir);
  }
});