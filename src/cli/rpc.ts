import { connect, type Socket } from "node:net";
import type { Config } from "../config.ts";
import { socketPathFor } from "../daemon.ts";

export interface RpcResponse {
  ok: boolean;
  body?: any;
  error?: string;
  exitCode?: number;
}

export async function rpc(config: Config, message: Record<string, unknown>): Promise<RpcResponse> {
  const socket = await connectSocket(socketPathFor(config));
  try {
    return await new Promise<RpcResponse>((resolve, reject) => {
      let buffer = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        const index = buffer.indexOf("\n");
        if (index < 0) return;
        try {
          resolve(JSON.parse(buffer.slice(0, index)) as RpcResponse);
        } catch (error) {
          reject(error);
        }
        socket.end();
      });
      socket.on("error", reject);
      socket.write(`${JSON.stringify(message)}\n`);
    });
  } finally {
    socket.destroy();
  }
}

export async function stream(
  config: Config,
  message: Record<string, unknown>,
  format: (body: any) => string = (body) => JSON.stringify(body),
): Promise<void> {
  const socket = await connectSocket(socketPathFor(config));
  socket.setEncoding("utf8");
  let buffer = "";
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line) {
        const response = JSON.parse(line) as RpcResponse;
        if (!response.body?.subscribed) process.stdout.write(`${format(response.body)}\n`);
      }
      index = buffer.indexOf("\n");
    }
  });
  socket.write(`${JSON.stringify(message)}\n`);
  await new Promise<void>((resolve) => socket.on("close", () => resolve()));
}

function connectSocket(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    socket.once("connect", () => resolve(socket));
    socket.once("error", (error) =>
      reject(new Error(`cannot reach pollhook at ${path}: ${error.message}`)),
    );
  });
}
