// Test-side LSP client: writes frames to the warden's client side and reads
// the frames it emits back. Framing logic is implemented independently here
// (byte-length Content-Length, chunk-accumulating parser) so a bug in the
// warden's framing can never be masked by a shared implementation.
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

/** One parsed JSON-RPC message as delivered by the warden to the client. */
export interface ClientFrame {
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

type Waiter = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

export class FrameClient {
  private buf = new Uint8Array(0);
  private queue: unknown[] = [];
  private waiters: Waiter[] = [];
  private closed = false;
  private reading = false;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();

  constructor(
    private clientIn: WritableStream<Uint8Array>,
    private clientOut: ReadableStream<Uint8Array>,
  ) {}

  /** Serialize + frame a message; Content-Length is the UTF-8 BYTE length. */
  encodeFrame(msg: unknown): Uint8Array {
    const body = this.encoder.encode(JSON.stringify(msg));
    const header = this.encoder.encode(`Content-Length: ${body.byteLength}\r\n\r\n`);
    const frame = new Uint8Array(header.length + body.length);
    frame.set(header, 0);
    frame.set(body, header.length);
    return frame;
  }

  /** Write raw bytes to the client side (WHATWG contract only; the self-tests
   * wrap Bun subprocess pipes into a real WritableStream). */
  private async writeBytes(bytes: Uint8Array): Promise<void> {
    const w = this.clientIn.getWriter();
    try {
      await w.write(bytes);
    } finally {
      w.releaseLock();
    }
  }

  async send(msg: unknown): Promise<void> {
    await this.writeBytes(this.encodeFrame(msg));
  }

  /** Write raw bytes (pre-concatenated frames, dribbled bytes, garbage). */
  async sendBytes(bytes: Uint8Array): Promise<void> {
    await this.writeBytes(bytes);
  }

  /**
   * Next parsed frame from clientOut. Rejects when the warden closes the
   * stream ("clientOut closed" — that is how F5 observes a fatal frame error)
   * or after `timeoutMs` without a frame.
   */
  async receive(timeoutMs = 2000): Promise<ClientFrame> {
    const ready = this.queue.shift();
    if (ready !== undefined) return ready as ClientFrame;
    if (this.closed) throw new Error("clientOut closed");
    this.startReading();
    return new Promise<ClientFrame>((resolve, reject) => {
      const waiter: Waiter = {
        resolve: (v: unknown) => {
          clearTimeout(timer);
          resolve(v as ClientFrame);
        },
        reject: (e: Error) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        waiter.reject(new Error(`receive() timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.waiters.push(waiter);
      const late = this.queue.shift();
      if (late !== undefined) this.deliver(late);
    });
  }

  private deliver(frame: unknown): void {
    const next = this.waiters.shift();
    if (next) next.resolve(frame);
    else this.queue.push(frame);
  }

  private fail(e: Error): void {
    for (const w of this.waiters.splice(0)) w.reject(e);
    this.closed = true;
  }

  private startReading(): void {
    if (this.reading) return;
    this.reading = true;
    void this.readLoop();
  }

  private async readLoop(): Promise<void> {
    const reader = this.clientOut.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        for (const w of this.waiters.splice(0)) w.reject(new Error("clientOut closed"));
        this.closed = true;
        return;
      }
      this.ingest(value);
    }
  }

  private ingest(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf, 0);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
    for (;;) {
      const sep = indexOfSeq(this.buf, CRLFCRLF);
      if (sep < 0) return; // header incomplete — wait for more bytes
      const header = this.decoder.decode(this.buf.slice(0, sep));
      const m = /^Content-Length:\s*(\d+)\s*$/i.exec(header);
      if (!m) {
        this.fail(new Error(`malformed frame header: ${JSON.stringify(header)}`));
        return;
      }
      const total = sep + 4 + Number(m[1]);
      if (this.buf.length < total) return; // body incomplete — wait for more bytes
      const body = this.decoder.decode(this.buf.slice(sep + 4, total));
      this.buf = this.buf.slice(total);
      let msg: unknown;
      try {
        msg = JSON.parse(body);
      } catch (e) {
        this.fail(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      this.deliver(msg);
    }
  }
}