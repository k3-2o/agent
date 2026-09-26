// P9 · Scopes — multi-child routing, longest prefix, unmatched errors,
// per-scope sleep/budget isolation. Frozen-red until `warden/warden.ts`.
import { test, expect } from "bun:test";
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
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

// Scope tests must control the warden's cwd (--scopes expands relative to it,
// and the FakeServer falls back to <cwd>/fake-server.log). Bun runs each test
// file in its own process, so chdir is contained to this file.
const originalCwd = process.cwd();

function makeScope(root: string, name: string): void {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, "tsconfig.json"), "{}");
}

const fileUri = (root: string, rel: string) => `file://${join(root, rel)}`;
const scopeLog = (root: string, name: string) => () => readLog(join(root, name, "fake-server.log"));

const INIT_PARAMS = { processId: null, rootUri: "file:///scopes", capabilities: {} };
const didOpenParams = (uri: string) => ({
  textDocument: { uri, languageId: "typescript", version: 1, text: `text of ${uri}` },
});

async function withScopedWarden(
  dir: string,
  extraFlags: string[],
  clock: FakeClock,
  pidReader: ((pid: number) => number | undefined) | undefined,
  fn: (w: WardenHandle) => Promise<void>,
): Promise<void> {
  const w = await createWarden(
    ["--scopes", "pkg*", "--log", join(dir, "warden.jsonl"), ...extraFlags, "--", "bun", fakeServerPath],
    { clock, ...(pidReader ? { pidReader } : {}) },
  );
  try {
    await fn(w);
  } finally {
    await w.dispose();
  }
}

test("K1 prefix routing hits exactly the matching scope's child", async () => {
  const dir = tmpdir();
  process.chdir(dir);
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: undefined }, async () => {
      makeScope(dir, "pkgA");
      makeScope(dir, "pkgB");
      await withScopedWarden(dir, [], new FakeClock(), undefined, async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        const uriA = fileUri(dir, "pkgA/src/a.ts");
        const uriB = fileUri(dir, "pkgB/b.ts");
        const logA = scopeLog(dir, "pkgA");
        const logB = scopeLog(dir, "pkgB");

        await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
        const resp = await c.receive();
        expect(resp.id).toBe(1);
        // URI-less messages route to the first scope in expansion order (pkgA).
        await waitFor(() => startPids(logA()).length === 1);
        expect(recvs(logA()).some((e) => e.method === "initialize")).toBe(true);
        expect(logB()).toHaveLength(0); // pkgB untouched so far

        await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
        await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA) });
        await waitFor(() => recvs(logA()).some((e) => e.method === "textDocument/didOpen"));
        expect(logB()).toHaveLength(0); // still untouched after pkgA traffic

        // A pkgB uri spawns ONLY the pkgB child.
        await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriB) });
        await waitFor(() => startPids(logB()).length === 1);
        await waitFor(() => recvs(logB()).some((e) => e.method === "textDocument/didOpen"));
        await settle(100);
        expect(startPids(logA())).toHaveLength(1); // pkgA child NOT respawned
        expect(recvs(logA()).some((e) => e.params !== undefined && JSON.stringify(e.params).includes(uriB))).toBe(false);
        expect(recvs(logB()).some((e) => e.params !== undefined && JSON.stringify(e.params).includes(uriA))).toBe(false);
      });
    });
  } finally {
    process.chdir(originalCwd);
    rmdir(dir);
  }
});

test("K2 longest prefix wins", async () => {
  const dir = tmpdir();
  process.chdir(dir);
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: undefined }, async () => {
      makeScope(dir, "pkgA");
      makeScope(dir, "pkgAB"); // also matches "pkgA" as a prefix
      makeScope(dir, "pkgB");
      await withScopedWarden(dir, [], new FakeClock(), undefined, async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        const uriAB = fileUri(dir, "pkgAB/src/x.ts");
        const uriA2 = fileUri(dir, "pkgA/nested/deep.ts");
        const logA = scopeLog(dir, "pkgA");
        const logAB = scopeLog(dir, "pkgAB");
        const logB = scopeLog(dir, "pkgB");

        await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
        await c.receive();
        await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
        await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriAB) });
        await waitFor(() => startPids(logAB()).length === 1);
        await waitFor(() => recvs(logAB()).some((e) => e.method === "textDocument/didOpen"));

        await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA2) });
        await waitFor(() => recvs(logA()).some((e) => e.method === "textDocument/didOpen"));
        await settle(100);
        expect(logB()).toHaveLength(0);
        const inLogA = (uri: string) =>
          recvs(logA()).some((e) => e.params !== undefined && JSON.stringify(e.params).includes(uri));
        const inLogAB = (uri: string) =>
          recvs(logAB()).some((e) => e.params !== undefined && JSON.stringify(e.params).includes(uri));
        expect(inLogA(uriA2)).toBe(true); // pkgA/nested/deep.ts → pkgA
        expect(inLogAB(uriA2)).toBe(false);
        expect(inLogAB(uriAB)).toBe(true); // pkgAB/src/x.ts → pkgAB (longest prefix)
        expect(inLogA(uriAB)).toBe(false);
      });
    });
  } finally {
    process.chdir(originalCwd);
    rmdir(dir);
  }
});

test("K3 unmatched uri answers -32027 and spawns nothing", async () => {
  const dir = tmpdir();
  process.chdir(dir);
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: undefined }, async () => {
      makeScope(dir, "pkgA");
      await withScopedWarden(dir, [], new FakeClock(), undefined, async (w) => {
        const c = new FrameClient(w.clientIn, w.clientOut);
        await c.send({
          jsonrpc: "2.0",
          id: 99,
          method: "textDocument/hover",
          params: { textDocument: { uri: "file:///tmp/x.ts" }, position: { line: 0, character: 0 } },
        });
        const resp = await c.receive();
        expect(resp.id).toBe(99);
        expect(resp.error).toEqual({ code: -32027, message: "lsp-warden: no scope for uri" });
        await settle(150);
        expect(readdirSync(join(dir, "pkgA"))).toEqual(["tsconfig.json"]); // no child ever spawned
      });
    });
  } finally {
    process.chdir(originalCwd);
    rmdir(dir);
  }
});

test("K4 per-scope isolation: budget restart and sleep touch only their scope", async () => {
  const dir = tmpdir();
  process.chdir(dir);
  try {
    await withEnv({ WARDEN_TEST_FAKE: undefined, WARDEN_TEST_LOG: undefined }, async () => {
      makeScope(dir, "pkgA");
      makeScope(dir, "pkgB");
      const clock = new FakeClock();
      // Closure: pidA1 is assigned after the pkgA child spawns, before the
      // first sample at fake t=1 s. Any other pid reads as under-budget.
      let pidA1 = 0;
      const pidReader = (pid: number): number | undefined => (pid === pidA1 ? 600_000 : undefined);
      await withScopedWarden(
        dir,
        ["--budget-mb", "512", "--sample-secs", "1", "--sustain", "1", "--sleep-after", "10"],
        clock,
        pidReader,
        async (w) => {
          const c = new FrameClient(w.clientIn, w.clientOut);
          const uriA = fileUri(dir, "pkgA/src/a.ts");
          const uriB = fileUri(dir, "pkgB/src/b.ts");
          const logA = scopeLog(dir, "pkgA");
          const logB = scopeLog(dir, "pkgB");

          await c.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: INIT_PARAMS });
          await c.receive();
          pidA1 = startPids(logA())[0];
          await c.send({ jsonrpc: "2.0", method: "initialized", params: {} });
          await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriA) });
          await c.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: didOpenParams(uriB) });
          await waitFor(() => startPids(logB()).length === 1);
          const pidB = startPids(logB())[0];

          // pkgA is over budget at the 1 s sample → ONLY pkgA restarts.
          await clock.tick(2000);
          await waitFor(() => startPids(logA()).length === 2);
          const pidA2 = startPids(logA())[1];
          await settle(100);
          expect(startPids(logB())).toHaveLength(1); // pkgB child untouched
          expect(logB().filter((e) => e.ev === "sigterm")).toHaveLength(0);
          expect(recvs(logA()).filter((e) => e.method === "initialize")).toHaveLength(2);

          // pkgB stays healthy while pkgA restarted (its hover lands at fake t=2 s).
          await c.send({
            jsonrpc: "2.0",
            id: 60,
            method: "textDocument/hover",
            params: { textDocument: { uri: uriB }, position: { line: 0, character: 0 } },
          });
          const resp = await c.receive();
          expect(resp.id).toBe(60);
          expect(recvs(logB()).some((e) => e.method === "textDocument/hover")).toBe(true);

          // tick ends at t = 12 s: pkgA (last activity t=0) slept at 10 s; pkgB
          // (activity at t=2 s) crosses its deadline exactly AT 12 s — SPEC's
          // strict `>` keeps it alive when the tick ends (deterministic).
          await clock.tick(10000);
          await waitFor(() => !alive(pidA2));
          expect(alive(pidB)).toBe(true);
          const wl = readLog(join(dir, "warden.jsonl"));
          expect(wl.some((e) => e.ev === "restart" && e.reason === "budget")).toBe(true);
          expect(wl.some((e) => e.ev === "sleep")).toBe(true);
          expect(logA().filter((e) => e.ev === "sigterm")).toHaveLength(2); // restart kill + sleep kill
          expect(logB().filter((e) => e.ev === "sigterm")).toHaveLength(0);
        },
      );
    });
  } finally {
    process.chdir(originalCwd);
    rmdir(dir);
  }
});