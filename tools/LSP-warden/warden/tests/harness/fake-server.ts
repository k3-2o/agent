// Spawnable fake LSP server for the lsp-warden test suite.
// Run standalone: `bun fake-server.ts` (this is the warden's child argv tail).
// Env config (all optional):
//   WARDEN_TEST_FAKE  JSON: { "dieOn": method?, "errorOn": [methods]?,
//                            "hold": [methods]?, "serverReqAfterInit": {method,id}? }
//   WARDEN_TEST_LOG   JSONL log path; default <cwd>/fake-server.log
// Log events: start{pid}, recv, die, sigterm, eof. All appends are unbuffered.
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const logPath = process.env.WARDEN_TEST_LOG ?? join(process.cwd(), "fake-server.log");

interface FakeConfig {
  dieOn?: string;
  errorOn?: string[];
  hold?: string[];
  serverReqAfterInit?: { method: string; id: string | number };
}
let fake: FakeConfig = {};
try {
  const parsed: unknown = process.env.WARDEN_TEST_FAKE ? JSON.parse(process.env.WARDEN_TEST_FAKE) : null;
  if (parsed !== null && typeof parsed === "object") fake = parsed as FakeConfig;
} catch {
  // env misuse — behave as plain echo server
}

function logEvent(ev: string, extra: Record<string, unknown> = {}): void {
  appendFileSync(logPath, JSON.stringify({ ev, ...extra }) + "\n");
}
logEvent("start", { pid: process.pid });

interface WireMsg {
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}
function asMsg(v: unknown): WireMsg | null {
  if (v === null || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  const out: WireMsg = {};
  if (typeof m.id === "string" || typeof m.id === "number") out.id = m.id;
  if (typeof m.method === "string") out.method = m.method;
  if ("params" in m) out.params = m.params;
  if ("result" in m) out.result = m.result;
  if ("error" in m) out.error = m.error;
  return out;
}

function logRecv(msg: WireMsg): void {
  const line: Record<string, unknown> = { ev: "recv" };
  if (msg.method !== undefined) line.method = msg.method;
  if (msg.id !== undefined) line.id = msg.id;
  if (msg.params !== undefined) line.params = msg.params;
  if (msg.result !== undefined) line.result = msg.result;
  if (msg.error !== undefined) line.error = msg.error;
  logEvent("recv", line);
}

const encoder = new TextEncoder();
const out = Bun.stdout.writer();

function writeFrame(msg: unknown): void {
  const body = encoder.encode(JSON.stringify(msg));
  const header = encoder.encode(`Content-Length: ${body.byteLength}\r\n\r\n`);
  const frame = new Uint8Array(header.length + body.length);
  frame.set(header, 0);
  frame.set(body, header.length);
  out.write(frame);
}

const held: WireMsg[] = [];
let serverRequestSent = false;

/** Answer a request, bypassing the hold gate (used by normal routing AND release). */
async function answer(req: WireMsg): Promise<void> {
  if (req.method === "initialize") {
    writeFrame({
      jsonrpc: "2.0",
      id: req.id,
      result: { capabilities: { fakeMarker: String(process.pid) } },
    });
    const sra = fake.serverReqAfterInit;
    if (sra && !serverRequestSent) {
      serverRequestSent = true;
      writeFrame({
        jsonrpc: "2.0",
        id: sra.id,
        method: sra.method,
        params: { uri: "test://server-request", source: sra.method },
      });
    }
    await out.flush();
    return;
  }
  if (fake.errorOn?.includes(req.method)) {
    writeFrame({ jsonrpc: "2.0", id: req.id, error: { code: -32001, message: "fake error" } });
    await out.flush();
    return;
  }
  writeFrame({
    jsonrpc: "2.0",
    id: req.id,
    result: { ok: true, echoMethod: req.method, echoParams: req.params },
  });
  await out.flush();
}

/** Release the OLDEST held request (answers it). Tests drive this via $/fake/release. */
function releaseOne(): void {
  const req = held.shift();
  if (req) void answer(req);
}

async function handle(msg: WireMsg): Promise<void> {
  logRecv(msg);
  // dieOn is a test-control killswitch: triggers on ANY message with the
  // method, request or notification (R5 dies on a didChange notification).
  if (msg.method !== undefined && fake.dieOn === msg.method) {
    logEvent("die", { method: msg.method });
    process.exit(1);
  }
  if (msg.method !== undefined && msg.id !== undefined) {
    // request
    if (fake.hold?.includes(msg.method)) {
      held.push(msg);
      return;
    }
    await answer(msg);
  } else if (msg.method === "$/fake/release") {
    releaseOne(); // this notification releases, and is itself logged above
  }
  // responses (no method) and other notifications: log only
}

// --- framing: byte-length Content-Length, chunk-accumulating -------------
let buf = new Uint8Array(0);
const decoder = new TextDecoder();
const CRLFCRLF = new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a]);

function indexOfSeq(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function ingest(chunk: Uint8Array): void {
  const merged = new Uint8Array(buf.length + chunk.length);
  merged.set(buf, 0);
  merged.set(chunk, buf.length);
  buf = merged;
  for (;;) {
    const sep = indexOfSeq(buf, CRLFCRLF);
    if (sep < 0) return;
    const header = decoder.decode(buf.slice(0, sep));
    const m = /^Content-Length:\s*(\d+)\s*$/i.exec(header);
    if (!m) {
      appendFileSync(logPath, JSON.stringify({ ev: "error", reason: "frame" }) + "\n");
      process.exit(1);
    }
    const total = sep + 4 + Number(m[1]);
    if (buf.length < total) return;
    const body = decoder.decode(buf.slice(sep + 4, total));
    buf = buf.slice(total);
    const msg = asMsg(JSON.parse(body));
    if (msg) void handle(msg);
  }
}

process.stdin.on("data", (chunk: Buffer) => ingest(new Uint8Array(chunk)));
process.stdin.on("end", () => {
  logEvent("eof");
  process.exit(0);
});
process.on("SIGTERM", () => {
  logEvent("sigterm");
  process.exit(0);
});