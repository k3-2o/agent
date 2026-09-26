// Harness self-tests — GREEN from day one. These guard against the
// "broken harness masquerading as broken warden" failure mode: if the fake
// server, frame client, or fake clock themselves lie, every later case file
// is meaningless. They import ONLY the harness, never `../warden`.
import { test, expect } from "bun:test";
import { join } from "node:path";
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

// Note on real-time windows: the FakeServer is a real spawned subprocess, so
// "no response while held" is a negative assertion that needs a real quiescence
// window — deterministic clocks cannot observe the ABSENCE of pipe traffic.

/** The Subprocess surface the selftests consume (Bun's pipe stdio). */
interface FakeChild {
  readonly pid: number;
  stdin: { write(b: Uint8Array): unknown; flush(): unknown };
  stdout: ReadableStream<Uint8Array>;
  kill(): void;
  exited: Promise<number>;
}

/**
 * Spawn the FakeServer. Bun.spawn does NOT inherit runtime process.env
 * mutations (it snapshots the environment at process start), so the env is
 * merged EXPLICITLY — this mirrors the warden's env-merge contract that the
 * implementation phases must honor.
 */
function spawnFake(dir: string): FakeChild {
  return Bun.spawn(["bun", fakeServerPath], {
    cwd: dir,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: { ...process.env },
  });
}

/**
 * Bun subprocess stdin is a FileSink (write/flush), not a WHATWG stream.
 * FrameClient speaks strictly the frozen WardenHandle contract, so the pipe is
 * wrapped into a real WritableStream here — the harness core never sees
 * Bun-specific I/O. flush() doubles as the backpressure signal.
 */
function stdinStream(child: FakeChild): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      child.stdin.write(chunk);
      return child.stdin.flush();
    },
  });
}

async function killAndWait(child: FakeChild): Promise<void> {
  try {
    child.kill();
  } catch {}
  await child.exited.catch(() => {});
}

test("selftest: fake server answers initialize", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      const child = spawnFake(dir);
      try {
        const client = new FrameClient(stdinStream(child), child.stdout);
        await client.send({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { processId: null, rootUri: "file:///selftest", capabilities: {} },
        });
        const resp = await client.receive();
        expect(resp.id).toBe(1);
        expect(resp.result).toEqual({ capabilities: { fakeMarker: String(child.pid) } });
        const log = readLog(join(dir, "fake.jsonl"));
        expect(startPids(log)).toEqual([child.pid]);
        expect(recvs(log).map((e) => e.method)).toEqual(["initialize"]);
      } finally {
        await killAndWait(child);
      }
    });
  } finally {
    rmdir(dir);
  }
});

test("selftest: frame writer/reader round-trips utf-8 multibyte", async () => {
  const dir = tmpdir();
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: join(dir, "fake.jsonl") }, async () => {
      const child = spawnFake(dir);
      try {
        const client = new FrameClient(stdinStream(child), child.stdout);
        const text = "héllo 🎉 wörld — 中文テスト".repeat(100); // 8 codepoints → 11 bytes each
        const params = {
          textDocument: {
            uri: "file:///selftest/mb.ts",
            languageId: "typescript",
            version: 1,
            text,
          },
        };
        await client.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params });
        await waitFor(() => recvs(readLog(join(dir, "fake.jsonl"))).some((e) => e.method === "textDocument/didOpen"));
        const recv = recvs(readLog(join(dir, "fake.jsonl"))).find((e) => e.method === "textDocument/didOpen")!;
        expect(recv.params).toEqual(params);
        expect(new TextEncoder().encode(text).byteLength).toBeGreaterThan(text.length);
      } finally {
        await killAndWait(child);
      }
    });
  } finally {
    rmdir(dir);
  }
});

test("selftest: fake clock fires timers in due order", async () => {
  const clock = new FakeClock();
  const fired: string[] = [];
  clock.setTimeout(() => fired.push("A"), 5);
  clock.setTimeout(() => fired.push("B"), 3);
  clock.setTimeout(() => fired.push("C"), 3);
  await clock.tick(4);
  expect(fired).toEqual(["B", "C"]);
  expect(clock.now()).toBe(4);
  await clock.tick(2);
  expect(fired).toEqual(["B", "C", "A"]);
  expect(clock.now()).toBe(6);

  const h = clock.setTimeout(() => fired.push("X"), 1);
  clock.clearTimeout(h);
  await clock.tick(2);
  expect(fired).toEqual(["B", "C", "A"]);

  clock.setTimeout(() => {
    fired.push("D");
    clock.setTimeout(() => fired.push("E"), 1);
  }, 1);
  await clock.tick(2);
  expect(fired).toEqual(["B", "C", "A", "D", "E"]);
});

test("selftest: fake server holds and releases", async () => {
  const dir = tmpdir();
  try {
    await withEnv(
      {
        WARDEN_TEST_FAKE: JSON.stringify({ hold: ["textDocument/diagnostic"] }),
        WARDEN_TEST_LOG: join(dir, "fake.jsonl"),
      },
      async () => {
        const child = spawnFake(dir);
        try {
          const client = new FrameClient(stdinStream(child), child.stdout);
          const params = { textDocument: { uri: "file:///selftest/hold.ts" } };
          await client.send({ jsonrpc: "2.0", id: 7, method: "textDocument/diagnostic", params });
          await expect(client.receive(300)).rejects.toThrow(/timed out/);
          await client.send({ jsonrpc: "2.0", method: "$/fake/release" });
          const resp = await client.receive(2000);
          expect(resp.id).toBe(7);
          expect(resp.result).toEqual({
            ok: true,
            echoMethod: "textDocument/diagnostic",
            echoParams: params,
          });
          expect(recvs(readLog(join(dir, "fake.jsonl"))).filter((e) => e.method === "$/fake/release")).toHaveLength(1);
        } finally {
          await killAndWait(child);
        }
      },
    );
  } finally {
    rmdir(dir);
  }
});