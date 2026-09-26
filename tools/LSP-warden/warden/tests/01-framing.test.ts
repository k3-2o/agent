// P1 · Wire — framing. Frozen-red until `warden/warden.ts` exists.
// Content-Length framing through the warden, both directions, byte-exact.
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
const wardenLog = (dir: string) => () => readLog(join(dir, "warden.jsonl"));

test("F1 two frames in one chunk", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      await withWarden(dir, new FakeClock(), async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        const m1 = {
          jsonrpc: "2.0",
          method: "textDocument/didOpen",
          params: {
            textDocument: {
              uri: "file:///f1/a.ts",
              languageId: "typescript",
              version: 1,
              text: "one",
            },
          },
        };
        const m2 = {
          jsonrpc: "2.0",
          method: "textDocument/didChange",
          params: {
            textDocument: { uri: "file:///f1/a.ts", version: 2 },
            contentChanges: [{ text: "two" }],
          },
        };
        const f1 = c.encodeFrame(m1);
        const f2 = c.encodeFrame(m2);
        const chunk = new Uint8Array(f1.length + f2.length);
        chunk.set(f1, 0);
        chunk.set(f2, f1.length);
        await c.sendBytes(chunk); // ONE write with both frames
        await waitFor(() => recvs(fakeLog(dir)()).length >= 2);
        const recv = recvs(fakeLog(dir)());
        expect(recv[0].method).toBe("textDocument/didOpen");
        expect(recv[0].params).toEqual(m1.params);
        expect(recv[1].method).toBe("textDocument/didChange");
        expect(recv[1].params).toEqual(m2.params);
      });
    });
  } finally {
    rmdir(dir);
  }
});

test("F2 2 MB payload round-trips uncapped", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      await withWarden(dir, new FakeClock(), async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        const text = "x".repeat(2 * 1024 * 1024);
        const open = {
          jsonrpc: "2.0",
          method: "textDocument/didOpen",
          params: {
            textDocument: { uri: "file:///f2/big.ts", languageId: "typescript", version: 1, text },
          },
        };
        await c.send(open);
        await waitFor(() => recvs(fakeLog(dir)()).some((e) => e.method === "textDocument/didOpen"));
        const recv = recvs(fakeLog(dir)()).find((e) => e.method === "textDocument/didOpen")!;
        expect(recv.params).toEqual(open.params);
        expect(new TextEncoder().encode(text).byteLength).toBe(2097152);
      });
    });
  } finally {
    rmdir(dir);
  }
});

test("F3 byte-length framing, not string-length (multibyte UTF-8)", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      await withWarden(dir, new FakeClock(), async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        // 8 codepoints, 11 UTF-8 bytes — a codepoint-counting Content-Length
        // would truncate or corrupt this payload.
        const text = "héllo 🎉 wörld — 中文テスト".repeat(25);
        const open = {
          jsonrpc: "2.0",
          method: "textDocument/didOpen",
          params: {
            textDocument: { uri: "file:///f3/mb.ts", languageId: "typescript", version: 1, text },
          },
        };
        await c.send(open);
        await waitFor(() => recvs(fakeLog(dir)()).some((e) => e.method === "textDocument/didOpen"));
        const recv = recvs(fakeLog(dir)()).find((e) => e.method === "textDocument/didOpen")!;
        expect(recv.params).toEqual(open.params);
      });
    });
  } finally {
    rmdir(dir);
  }
});

test("F4 dribbled frame bytes still parse", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      await withWarden(dir, new FakeClock(), async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        const open = {
          jsonrpc: "2.0",
          method: "textDocument/didOpen",
          params: {
            textDocument: {
              uri: "file:///f4/dribble.ts",
              languageId: "typescript",
              version: 1,
              text: "dribble",
            },
          },
        };
        const frame = c.encodeFrame(open);
        for (let i = 0; i < frame.length; i++) {
          await c.sendBytes(frame.slice(i, i + 1)); // one byte per write
        }
        await waitFor(() => recvs(fakeLog(dir)()).some((e) => e.method === "textDocument/didOpen"));
        const recv = recvs(fakeLog(dir)()).find((e) => e.method === "textDocument/didOpen")!;
        expect(recv.params).toEqual(open.params);
      });
    });
  } finally {
    rmdir(dir);
  }
});

test("F5 malformed frame is fatal and loud", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      await withWarden(dir, new FakeClock(), async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        // Bytes that can never form a valid Content-Length header.
        await c.sendBytes(new TextEncoder().encode("this is not an lsp frame\r\n\r\n"));
        await expect(c.receive(2000)).rejects.toThrow(/closed/);
        await waitFor(() => wardenLog(dir)().some((e) => e.ev === "error" && e.reason === "frame"));
        // The warden stopped: no more traffic flows, no child respawned.
        const starts = startPids(fakeLog(dir)());
        expect(starts.length).toBeLessThanOrEqual(1);
        await settle(100);
        expect(startPids(fakeLog(dir)()).length).toBe(starts.length);
      });
    });
  } finally {
    rmdir(dir);
  }
});