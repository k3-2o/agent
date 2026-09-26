// P8 · Limiter — max-inflight FIFO on expensive methods; notifications and
// cheap methods bypass. Frozen-red until `warden/warden.ts` exists.
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
} from "./harness/util";

async function withWarden(
  dir: string,
  extraFlags: string[],
  fn: (w: WardenHandle) => Promise<void>,
): Promise<void> {
  const w = await createWarden(
    ["--log", join(dir, "warden.jsonl"), ...extraFlags, "--", "bun", fakeServerPath],
    { clock: new FakeClock() },
  );
  try {
    await fn(w);
  } finally {
    await w.dispose();
  }
}

const fakeLog = (dir: string) => () => readLog(join(dir, "fake.jsonl"));

const INIT_PARAMS = { processId: null, rootUri: "file:///limiter", capabilities: {} };
const uriA = "file:///limiter/a.ts";
const uriB = "file:///limiter/b.ts";
const didOpenParams = (uri: string) => ({
  textDocument: { uri, languageId: "typescript", version: 1, text: `text of ${uri}` },
});
const diagParams = (uri: string, line: number) => ({
  textDocument: { uri },
  position: { line, character: 0 },
});

test("Q1 strict FIFO sequencing with --max-inflight 1", async () => {
  const dir = tmpdir();
  try {
    await withEnv(
      {
        WARDEN_TEST_FAKE: JSON.stringify({ hold: ["textDocument/diagnostic"] }),
        WARDEN_TEST_LOG: join(dir, "fake.jsonl"),
      },
      async () => {
        await withWarden(dir, ["--max-inflight", "1"], async (w) => {
          const c = new FrameClient(w.clientIn, w.clientOut);
          await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
          await c.receive();
          await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
          await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA) });

          await c.send({ jsonrpc: "2.0", id: 42, method: "textDocument/diagnostic", params: diagParams(uriA, 42) });
          await c.send({ jsonrpc: "2.0", id: 43, method: "textDocument/diagnostic", params: diagParams(uriA, 43) });
          await c.send({ jsonrpc: "2.0", id: 44, method: "textDocument/diagnostic", params: diagParams(uriA, 44) });
          const diagRecvs = () => recvs(fakeLog(dir)()).filter((e) => e.method === "textDocument/diagnostic");

          await settle(150);
          expect(diagRecvs()).toHaveLength(1); // ONLY the first is forwarded
          expect(diagRecvs()[0].params).toEqual(diagParams(uriA, 42));

          await c.send({ jsonrpc: "2.0", method: "$/fake/release" });
          const r42 = await c.receive();
          expect(r42.id).toBe(42);
          await waitFor(() => diagRecvs().length === 2);
          expect(diagRecvs()[1].params).toEqual(diagParams(uriA, 43));

          await c.send({ jsonrpc: "2.0", method: "$/fake/release" });
          const r43 = await c.receive();
          expect(r43.id).toBe(43);
          await waitFor(() => diagRecvs().length === 3);
          expect(diagRecvs()[2].params).toEqual(diagParams(uriA, 44));

          await c.send({ jsonrpc: "2.0", method: "$/fake/release" });
          const r44 = await c.receive();
          expect(r44.id).toBe(44);
          await settle(100);
          expect(diagRecvs()).toHaveLength(3);
        });
      },
    );
  } finally {
    rmdir(dir);
  }
});

test("Q2 notifications bypass the limiter", async () => {
  const dir = tmpdir();
  try {
    await withEnv(
      {
        WARDEN_TEST_FAKE: JSON.stringify({ hold: ["textDocument/diagnostic"] }),
        WARDEN_TEST_LOG: join(dir, "fake.jsonl"),
      },
      async () => {
        await withWarden(dir, ["--max-inflight", "1"], async (w) => {
          const c = new FrameClient(w.clientIn, w.clientOut);
          await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
          await c.receive();
          await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
          await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA) });

          // One expensive request occupies the single inflight slot…
          await c.send({ jsonrpc: "2.0", id: 51, method: "textDocument/diagnostic", params: diagParams(uriA, 51) });
          await waitFor(() => recvs(fakeLog(dir)()).some((e) => e.method === "textDocument/diagnostic"));

          // …and a notification still arrives at the server immediately.
          await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriB) });
          await waitFor(() =>
            recvs(fakeLog(dir)()).some(
              (e) => e.method === "textDocument/didOpen" && e.params !== undefined && JSON.stringify(e.params).includes(uriB),
            ),
          );
          await settle(100);
          expect(recvs(fakeLog(dir)()).filter((e) => e.method === "textDocument/didOpen")).toHaveLength(2);
          expect(recvs(fakeLog(dir)()).filter((e) => e.method === "textDocument/diagnostic")).toHaveLength(1);
        });
      },
    );
  } finally {
    rmdir(dir);
  }
});

test("Q3 non-expensive methods pass despite a full queue", async () => {
  const dir = tmpdir();
  try {
    await withEnv(
      {
        WARDEN_TEST_FAKE: JSON.stringify({ hold: ["textDocument/diagnostic"] }),
        WARDEN_TEST_LOG: join(dir, "fake.jsonl"),
      },
      async () => {
        await withWarden(dir, ["--max-inflight", "1"], async (w) => {
          const c = new FrameClient(w.clientIn, w.clientOut);
          await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
          await c.receive();
          await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
          await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA) });

          await c.send({ jsonrpc: "2.0", id: 52, method: "textDocument/diagnostic", params: diagParams(uriA, 52) });
          await waitFor(() => recvs(fakeLog(dir)()).some((e) => e.method === "textDocument/diagnostic"));

          // shutdown is not on the expensive list → forwarded and answered
          // while the diagnostic sits held.
          await c.send({ jsonrpc: "2.0", id: 53, method: "shutdown" });
          await waitFor(() => recvs(fakeLog(dir)()).some((e) => e.method === "shutdown"));
          const resp = await c.receive();
          expect(resp.id).toBe(53);
          expect(resp.result).toEqual({ ok: true, echoMethod: "shutdown", echoParams: undefined });
          await settle(100);
          expect(recvs(fakeLog(dir)()).filter((e) => e.method === "textDocument/diagnostic")).toHaveLength(1);
        });
      },
    );
  } finally {
    rmdir(dir);
  }
});