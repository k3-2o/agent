// lsp-warden — wire layer: Content-Length framing, JSON-RPC shape classification, and the JSON codecs for rewritten messages — PURE byte/JSON (no time, processes, streams, fs); policy.ts and warden.ts import this leaf.

const CRLFCRLF = new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a]);
const HEADER_RE = /^Content-Length:\s*(\d+)\s*$/i;

function indexOfSeq(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.byteLength <= haystack.byteLength; i++) {
    for (let j = 0; j < needle.byteLength; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** Chunk-accumulating Content-Length parser — bodies are returned as byte slices, never re-decoded, so any payload round-trips uncapped; a bad header flips `fatal` permanently (SPEC §4.6). */
export class FrameParser {
  private buf = new Uint8Array(0);
  private decoder = new TextDecoder();
  fatal = false;

  feed(chunk: Uint8Array): Uint8Array[] {
    if (this.fatal || chunk.byteLength === 0) return [];
    const merged = new Uint8Array(this.buf.byteLength + chunk.byteLength);
    merged.set(this.buf, 0);
    merged.set(chunk, this.buf.byteLength);
    this.buf = merged;
    const out: Uint8Array[] = [];
    for (;;) {
      const sep = indexOfSeq(this.buf, CRLFCRLF);
      if (sep < 0) break;
      const header = this.decoder.decode(this.buf.slice(0, sep));
      const m = HEADER_RE.exec(header);
      if (!m) {
        this.fatal = true;
        return [];
      }
      const total = sep + 4 + Number(m[1]);
      if (this.buf.byteLength < total) break;
      out.push(this.buf.slice(sep + 4, total));
      this.buf = this.buf.slice(total);
    }
    return out;
  }

  /** Stream ended: a complete header whose declared body never arrived is fatal too; a dangling header fragment (no CRLFCRLF yet) is junk. */
  finish(): void {
    if (this.fatal || this.buf.byteLength === 0) return;
    if (indexOfSeq(this.buf, CRLFCRLF) >= 0) this.fatal = true;
  }
}

export function encodeFrame(body: Uint8Array): Uint8Array {
  const header = new TextEncoder().encode(`Content-Length: ${body.byteLength}\r\n\r\n`);
  const frame = new Uint8Array(header.byteLength + body.byteLength);
  frame.set(header, 0);
  frame.set(body, header.byteLength);
  return frame;
}

export const utf8 = new TextDecoder();
const textEncoder = new TextEncoder();

/** Serialize a rewritten message body — never applied to notification bytes (T3). */
export function encodeJson(v: unknown): Uint8Array {
  return textEncoder.encode(JSON.stringify(v));
}

/** JSON-RPC shape: request = method+id; notification = method without id; response = id without method (`id: null` counts, flows verbatim); anything else is not JSON-RPC. */
export function kindOf(msg: Record<string, unknown>): "request" | "response" | "notification" | null {
  const hasMethod = typeof msg.method === "string";
  const hasId = typeof msg.id === "number" || typeof msg.id === "string";
  if (hasMethod && hasId) return "request";
  if (hasMethod) return "notification";
  if (hasId || msg.id === null) return "response";
  return null;
}