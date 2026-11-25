import type { Socket } from "node:net";
import { resolveWait, type WaitOutcome, type WaitRequest } from "../waits.ts";
import type { DaemonContext } from "./context.ts";

const POLL_MS = 250;

export class Waiter {
  private readonly socket: Socket;
  private readonly request: WaitRequest;
  private readonly ctx: DaemonContext;
  private readonly timeoutMs: number;
  private settled = false;
  private interval: NodeJS.Timeout | undefined;
  private timer: NodeJS.Timeout | undefined;

  constructor(socket: Socket, request: WaitRequest, ctx: DaemonContext, timeoutMs: number) {
    this.socket = socket;
    this.request = request;
    this.ctx = ctx;
    this.timeoutMs = timeoutMs;
  }

  start(): void {
    this.ctx.listeners.add(this.wake);
    this.interval = setInterval(this.wake, POLL_MS);
    this.timer = setTimeout(
      () => this.finish({ exitCode: 8, body: { reason: "timeout" } }),
      this.timeoutMs,
    );
    this.wake();
  }

  wake = (): void => {
    const outcome = resolveWait(this.ctx.db, this.request);
    if (outcome) this.finish(outcome);
  };

  finish(outcome: WaitOutcome): void {
    if (!this.release()) return;
    this.socket.write(`${JSON.stringify({ ok: true, ...outcome })}\n`);
  }

  cancel(): void {
    this.release();
  }

  private release(): boolean {
    if (this.settled) return false;
    this.settled = true;
    if (this.interval) clearInterval(this.interval);
    if (this.timer) clearTimeout(this.timer);
    this.ctx.listeners.delete(this.wake);
    this.ctx.waiters.count -= 1;
    return true;
  }
}
