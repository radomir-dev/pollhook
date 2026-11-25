import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { tempStateDir } from "./helpers.ts";

const root = join(import.meta.dirname, "..");
const ack = { ok: true, body: { subscribed: true } };
const delivery = (id: string, createdAt: string) => ({ ok: true, body: { id, createdAt } });

function line(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}

async function stub(
  stateDir: string,
  onConnection: (socket: Socket, request: string, index: number) => void,
): Promise<{ server: Server; requests: string[] }> {
  const requests: string[] = [];
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.once("data", (chunk: string) => {
      requests.push(chunk.trim());
      onConnection(socket, chunk.trim(), requests.length);
    });
  });
  await new Promise<void>((resolve) => server.listen(join(stateDir, "pollhook.sock"), resolve));
  return { server, requests };
}

async function runEmit(
  stateDir: string,
  args: string[],
  lines: number,
): Promise<{ stdout: string[]; stderr: string }> {
  const configPath = join(stateDir, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({ repos: [{ repo: "acme/app", events: ["push"] }], stateDir }),
  );
  const child = spawn(process.execPath, ["src/cli.ts", "emit", ...args], {
    cwd: root,
    env: { ...process.env, POLLHOOK_CONFIG: configPath, XDG_RUNTIME_DIR: stateDir },
  });
  let stdout = "";
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  const enough = new Promise<void>((resolve) => {
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.trim().split("\n").length >= lines) resolve();
    });
  });
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 8000));
  await Promise.race([enough, timeout]);
  child.kill("SIGKILL");
  return { stdout: stdout.trim().split("\n").filter(Boolean), stderr };
}

test("emit subscribes and prints deliveries without the subscription ack", async () => {
  const stateDir = tempStateDir();
  const { server, requests } = await stub(stateDir, (socket) => {
    socket.write(line(ack) + line({ ok: true, body: { id: "d1", event: "push" } }));
  });

  try {
    const result = await runEmit(stateDir, [], 1);

    assert.equal(requests[0], '{"op":"emit"}');
    assert.deepEqual(result.stdout, ['{"id":"d1","event":"push"}']);
  } finally {
    server.close();
  }
});

test("emit reconnects after the daemon goes away and replays from the last delivery", async () => {
  const stateDir = tempStateDir();
  const first = "2026-11-25T12:00:00.000Z";
  const second = "2026-11-25T12:00:01.000Z";
  const { server, requests } = await stub(stateDir, (socket, _request, index) => {
    if (index === 1) {
      socket.end(line(ack) + line(delivery("d1", first)));
      return;
    }
    socket.write(line(ack) + line(delivery("d1", first)) + line(delivery("d2", second)));
  });

  try {
    const result = await runEmit(stateDir, [], 2);

    assert.deepEqual(
      result.stdout.map((entry) => JSON.parse(entry).id),
      ["d1", "d2"],
      "the replayed duplicate is printed once",
    );
    assert.equal(requests[0], '{"op":"emit"}');
    assert.deepEqual(JSON.parse(requests[1]!), { op: "emit", since: first });
    assert.match(result.stderr, /connection lost, reconnecting/);
    assert.match(result.stderr, /reconnected, replaying from 2026-11-25T12:00:00\.000Z/);
  } finally {
    server.close();
  }
});
