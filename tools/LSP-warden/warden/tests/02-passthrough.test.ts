// P1/P2 · Relay — passthrough fidelity, bidirectional ID remap, notification
// and error passthrough. Frozen-red until `warden/warden.ts` exists.
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
  recvs,
  startPids,
} from "./harness/util";

async function withWarden(
  dir: string,
  clock: FakeClock,
  fn: (w: WardenHandle) => Promise<void>,
): Promise<void> {
  const w = await createWarden(["--log", join(dir, "warden.jsonl"), "--", "bun", fakeServerPath], {
    clock,
  });
  try {
    await fn(w);
  } finally {
    await w.dispose();
  }
}

const fakeLog = (dir: string) => () => readLog(join(dir, "fake.jsonl"));

test("T1 request fidelity + id restore", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      await withWarden(dir, new FakeClock(), async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        const initParams = { processId: null, rootUri: "file:///t1", capabilities: {} };
        await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: initParams });
        const initResp = await c.receive();
        expect(initResp.id).toBe(1);
        await waitFor(() => startPids(fakeLog(dir)()).length === 1);
        expect(initResp.result).toEqual({
          capabilities: { fakeMarker: String(startPids(fakeLog(dir)())[0]) },
        });
        await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });

        const params = {
          textDocument: { uri: "file:///t1/a.ts" },
          position: { line: 1, character: 2 },
        };
        await c.send({ jsonrpc: "2.0", id: 42, method: "textDocument/hover", params });
        await waitFor(() => recvs(fakeLog(dir)()).some((e) => e.method === "textDocument/hover"));
        const req = recvs(fakeLog(dir)()).find((e) => e.method === "textDocument/hover")!;
        expect(req.params).toEqual(params); // child-side id may be remapped — never asserted
        const resp = await c.receive();
        expect(resp.id).toBe(42);
        expect(resp.result).toEqual({
          ok: true,
          echoMethod: "textDocument/hover",
          echoParams: params,
        });
      });
    });
  } finally {
    rmdir(dir);
  }
});

test("T2 server-to-client request relay and round-trip", async () => {
  const dir = tmpdir();
  try {
    await withEnv(
      {
        WARDEN_TEST_FAKE: JSON.stringify({
          serverReqAfterInit: { method: "workspace/applyEdit", id: "s1" },
        }),
        WARDEN_TEST_LOG: join(dir, "fake.jsonl"),
      },
      async () => {
        await withWarden(dir, new FakeClock(), async (w) => {
          const c = new FrameClient(w.clientIn, w.clientOut);
          await c.send({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { processId: null, rootUri: "file:///t2", capabilities: {} },
          });
          await c.receive(); // init response
          const srvReq = await c.receive(); // FakeServer's workspace/applyEdit
          expect(srvReq.method).toBe("workspace/applyEdit");
          expect(srvReq.params).toEqual({
            uri: "test://server-request",
            source: "workspace/applyEdit",
          });
          expect(typeof srvReq.id).not.toBe("undefined"); // client-side id (remapped)
          await c.send({ jsonrpc: "2.0", id: srvReq.id, result: { applied: true } });
          // The warden must map the client-side id back to the child-side id "s1".
          await waitFor(() =>
            recvs(fakeLog(dir)()).some((e) => {
              if (e.id !== "s1" || e.result === null || typeof e.result !== "object") return false;
              return "applied" in e.result && e.result.applied === true;
            }),
          );
          const resp = recvs(fakeLog(dir)()).find((e) => e.id === "s1")!;
          expect(resp.result).toEqual({ applied: true });
        });
      },
    );
  } finally {
    rmdir(dir);
  }
});

test("T3 notification passthrough is verbatim (no id injected)", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      await withWarden(dir, new FakeClock(), async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        await c.send({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { processId: null, rootUri: "file:///t3", capabilities: {} },
        });
        await c.receive();
        const params = { nested: { list: [1, 2, 3] }, flag: true, text: "initialized" };
        await c.send({ jsonrpc: "2.0", method: "initialized", params });
        await waitFor(() => recvs(fakeLog(dir)()).some((e) => e.method === "initialized"));
        const recv = recvs(fakeLog(dir)()).find((e) => e.method === "initialized")!;
        expect(recv.params).toEqual(params);
        expect(recv.id).toBeUndefined(); // notifications carry no id
      });
    });
  } finally {
    rmdir(dir);
  }
});

test("T4 response with error field passes through with id restored", async () => {
  const dir = tmpdir();
  try {
    await withEnv(
      {
        WARDEN_TEST_FAKE: JSON.stringify({ errorOn: ["textDocument/diagnostic"] }),
        WARDEN_TEST_LOG: join(dir, "fake.jsonl"),
      },
      async () => {
        await withWarden(dir, new FakeClock(), async (w) => {
          const c = new FrameClient(w.clientIn, w.clientOut);
          await c.send({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { processId: null, rootUri: "file:///t4", capabilities: {} },
          });
          await c.receive();
          const params = { textDocument: { uri: "file:///t4/a.ts" } };
          await c.send({ jsonrpc: "2.0", id: 7, method: "textDocument/diagnostic", params });
          await waitFor(() => recvs(fakeLog(dir)()).some((e) => e.method === "textDocument/diagnostic"));
          const resp = await c.receive();
          expect(resp.id).toBe(7);
          expect(resp.error).toEqual({ code: -32001, message: "fake error" });
          expect(resp.result).toBeUndefined();
        });
      },
    );
  } finally {
    rmdir(dir);
  }
});