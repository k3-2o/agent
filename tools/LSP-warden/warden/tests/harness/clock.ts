// Deterministic clock for warden policy timers.
// The warden schedules EVERY timer through Clock (frozen contract rule 1), so
// tests advance policy time in 1 ms steps and fire due timers in due order.
import type { Clock } from "../warden";

export class FakeClock implements Clock {
  private time = 0;
  private nextId = 1;
  private timers = new Map<number, { due: number; cb: () => void }>();

  now(): number {
    return this.time;
  }

  setTimeout(cb: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { due: this.time + ms, cb });
    return id;
  }

  clearTimeout(h: unknown): void {
    if (typeof h === "number") this.timers.delete(h);
  }

  /**
   * Advance `ms` of fake time. At each 1 ms step, timers due at or before the
   * new time fire in (due, insertion) order. After every fire a real event-loop
   * turn runs so pipe I/O (child stdin writes, child stdout reads) lands —
   * the warden's own timers never use real time, only the I/O convergence does.
   */
  async tick(ms: number): Promise<void> {
    const target = this.time + ms;
    while (this.time < target) {
      const step = this.time + 1;
      const due = [...this.timers.entries()]
        .filter(([, t]) => t.due <= step)
        .sort((a, b) => a[1].due - b[1].due || a[0] - b[0]);
      this.time = step;
      for (const [id, t] of due) {
        this.timers.delete(id);
        t.cb();
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    }
  }
}