import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { tempStateDir } from "./helpers.ts";

const root = join(import.meta.dirname, "..");

function serve(socket: Socket, received: string[], finished: () => void) {
  socket.setEncoding("utf8");
  socket.once("data", (chunk: string) => {
    received.push(chunk.trim());
    socket.write(`${JSON.stringify({ ok: true, body: { subscribed: true } })}\n`);
    socket.write(`${JSON.stringify({ ok: true, body: { id: "d1", event: "push" } })}\n`);
    socket.end(finished);
  });
}

test("emit subscribes and prints deliveries without the subscription ack", async () => {
  const stateDir = tempStateDir();
  const configPath = join(stateDir, "config.json");
  writeFileSync(configPath, JSON.stringify({ repos: [{ repo: "acme/app", events: ["push"] }], stateDir }));
  const received: string[] = [];
  let closed = () => {};
  const done = new Promise<void>((resolve) => (closed = resolve));
  const server = createServer((socket) => serve(socket, received, closed));
  await new Promise<void>((resolve) => server.listen(join(stateDir, "pollhook.sock"), resolve));

  const child = spawn(process.execPath, ["src/cli.ts", "emit"], {
    cwd: root,
    env: { ...process.env, POLLHOOK_CONFIG: configPath, XDG_RUNTIME_DIR: stateDir },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));

  try {
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    await done;
    assert.equal(code, 0, stderr);
    assert.deepEqual(received, ['{"op":"emit"}']);
    assert.equal(stdout.trim(), '{"id":"d1","event":"push"}');
  } finally {
    child.kill("SIGKILL");
    server.close();
  }
});
