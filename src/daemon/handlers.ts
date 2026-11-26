import type { Socket } from "node:net";
import { ADAPTERS, IMPLEMENTED_EVENTS } from "../registry.ts";
import type { Delivery } from "../types.ts";
import type { WaitRequest } from "../waits.ts";
import type { DaemonContext } from "./context.ts";
import { errorMessage } from "../util.ts";
import { Waiter } from "./waiter.ts";

const DEFAULT_WAIT_MS = 30 * 60 * 1000;
const WAIT_KINDS = new Set(["run", "checks", "pr", "pages", "event"]);

export function handleConnection(socket: Socket, ctx: DaemonContext): void {
  const cleanup: Array<() => void> = [];
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer = drain(socket, buffer + chunk, ctx, cleanup);
  });
  socket.on("close", () => {
    for (const fn of cleanup) fn();
  });
  socket.on("error", () => {});
}

function drain(
  socket: Socket,
  buffer: string,
  ctx: DaemonContext,
  cleanup: Array<() => void>,
): string {
  let index = buffer.indexOf("\n");
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) handleLine(socket, line, ctx, cleanup);
    index = buffer.indexOf("\n");
  }
  return buffer;
}

function handleLine(
  socket: Socket,
  line: string,
  ctx: DaemonContext,
  cleanup: Array<() => void>,
): void {
  let message: any;
  try {
    message = JSON.parse(line);
  } catch {
    writeLine(socket, { ok: false, error: "invalid json" });
    return;
  }
  try {
    handleRequest(socket, message, ctx, cleanup);
  } catch (error) {
    writeLine(socket, { ok: false, error: `request failed: ${errorMessage(error)}` });
  }
}

function handleRequest(
  socket: Socket,
  message: any,
  ctx: DaemonContext,
  cleanup: Array<() => void>,
): void {
  switch (message.op) {
    case "status":
      writeLine(socket, { ok: true, body: ctx.status() });
      return;
    case "events":
      writeLine(socket, { ok: true, body: eventList() });
      return;
    case "deliveries":
      writeLine(socket, {
        ok: true,
        body: ctx.db.listDeliveries(Number(message.limit ?? 20), message.repo),
      });
      return;
    case "poke":
      if (ctx.poke(message.repo)) writeLine(socket, { ok: true, body: { poked: true } });
      else writeLine(socket, { ok: false, error: `unknown repository ${String(message.repo)}` });
      return;
    case "stop":
      socket.write(`${JSON.stringify({ ok: true, body: { stopping: true } })}\n`, () => ctx.stop());
      return;
    case "emit":
      subscribe(socket, ctx, cleanup, message.since);
      return;
    case "wait":
      onWait(socket, message, ctx, cleanup);
      return;
    default:
      writeLine(socket, { ok: false, error: `unknown op ${String(message.op)}` });
  }
}

function eventList() {
  return IMPLEMENTED_EVENTS.map((event) => ({
    event,
    intervalFloorSeconds: ADAPTERS[event].intervalFloorMs / 1000,
  }));
}

function subscribe(
  socket: Socket,
  ctx: DaemonContext,
  cleanup: Array<() => void>,
  since: unknown,
): void {
  if (since !== undefined && (typeof since !== "string" || Number.isNaN(Date.parse(since)))) {
    writeLine(socket, { ok: false, error: "since must be an ISO timestamp" });
    return;
  }
  const listener = (delivery: Delivery) => writeLine(socket, { ok: true, body: delivery });
  ctx.listeners.add(listener);
  cleanup.push(() => ctx.listeners.delete(listener));
  writeLine(socket, { ok: true, body: { subscribed: true, pid: process.pid } });
  if (typeof since === "string") {
    for (const delivery of ctx.db.deliveriesSince(since))
      writeLine(socket, { ok: true, body: delivery });
  }
}

function onWait(
  socket: Socket,
  message: any,
  ctx: DaemonContext,
  cleanup: Array<() => void>,
): void {
  const request = message.request as WaitRequest;
  if (!request || typeof request.kind !== "string") {
    writeLine(socket, { ok: false, error: "wait request missing" });
    return;
  }
  if (!WAIT_KINDS.has(request.kind)) {
    writeLine(socket, { ok: false, error: `unknown wait kind ${request.kind}` });
    return;
  }
  seedChecksHead(ctx, request);
  ctx.waiters.count += 1;
  const waiter = new Waiter(socket, request, ctx, Number(message.timeoutMs ?? DEFAULT_WAIT_MS));
  cleanup.push(() => waiter.cancel());
  waiter.start();
}

function seedChecksHead(ctx: DaemonContext, request: WaitRequest): void {
  if (request.kind !== "checks" || request.initialHead) return;
  request.initialHead = ctx.db.getSnapshot(
    request.repo,
    "pull_request",
    String(request.pr),
  )?.data?.head?.sha;
}

function writeLine(socket: Socket, message: unknown): void {
  if (socket.destroyed) return;
  socket.write(`${JSON.stringify(message)}\n`);
}
