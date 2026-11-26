import { connect, type Socket } from "node:net";

export class DaemonUnreachable extends Error {}

export function connectSocket(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    socket.once("connect", () => resolve(socket));
    socket.once("error", (error) =>
      reject(new DaemonUnreachable(`cannot reach pollhook at ${path}: ${error.message}`)),
    );
  });
}
