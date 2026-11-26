import assert from "node:assert/strict";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "vitest";
import { StateStore } from "../src/db.ts";
import { GitHub } from "../src/github.ts";
import { dispatchCommand } from "../src/cli/commands.ts";
import type { Config } from "../src/config.ts";
import { startDaemon } from "../src/daemon.ts";
import { FakeGitHub, tempStateDir } from "./helpers.ts";

function repoConfig(stateDir: string, repos: string[]): Config {
  return {
    repos: repos.map((repo) => ({
      repo,
      events: ["workflow_run", "pull_request"],
      intervalMs: 60_000,
      checkRefLimit: 5,
    })),
    orgs: [],
    stateDir,
  };
}

async function capture(
  run: () => Promise<number>,
): Promise<{ code: number; out: string; err: string }> {
  const write = process.stdout.write.bind(process.stdout);
  const writeErr = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  process.stdout.write = ((chunk: string) => ((out += chunk), true)) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => ((err += chunk), true)) as typeof process.stderr.write;
  try {
    return { code: await run(), out, err };
  } finally {
    process.stdout.write = write;
    process.stderr.write = writeErr;
  }
}

async function withDaemon(repos: string[], run: (config: Config) => Promise<void>): Promise<void> {
  const stateDir = tempStateDir();
  const config = repoConfig(stateDir, repos);
  const previous = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = stateDir;
  const gh = new FakeGitHub(
    {},
    {},
    { [`/repos/${repos[0]}/actions/runs?per_page=50`]: "500 upstream failed" },
  );
  const daemon = await startDaemon(config, {
    gh,
    socketPath: join(stateDir, "pollhook.sock"),
    watch: false,
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await run(config);
  } finally {
    await daemon.close();
    if (previous === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = previous;
  }
}

test("an unknown command prints usage and exits 2", async () => {
  const result = await capture(() =>
    dispatchCommand(repoConfig(tempStateDir(), ["a/b"]), "nope", []),
  );

  assert.equal(result.code, 2);
  assert.match(result.err, /unknown command nope/);
  assert.match(result.err, /pollhook daemon/);
});

test("cleanup reports that no webhooks exist", async () => {
  const result = await capture(() =>
    dispatchCommand(repoConfig(tempStateDir(), ["a/b"]), "cleanup", []),
  );

  assert.equal(result.code, 0);
  assert.match(result.out, /creates no GitHub webhooks/);
});

test("status, events, deliveries and poke read from the daemon", async () => {
  await withDaemon(["acme/app"], async (config) => {
    const plain = await capture(() => dispatchCommand(config, "status", []));
    assert.equal(plain.code, 0);
    assert.match(plain.out, /acme\/app {2}events=2/);
    assert.match(plain.out, /error=500 upstream failed/);
    assert.match(plain.out, /degraded=pull_request/);
    assert.match(plain.out, /deliveries 0, waiters 0, streams 0, pid \d+/);

    const json = await capture(() => dispatchCommand(config, "status", ["--json"]));
    assert.equal(JSON.parse(json.out).repos[0].repo, "acme/app");

    const events = await capture(() => dispatchCommand(config, "events", []));
    assert.match(events.out, /^workflow_run\t\d+s$/m);
    assert.match(events.err, /docs\/events\.md/);

    const deliveries = await capture(() =>
      dispatchCommand(config, "deliveries", ["--limit", "5", "--repo", "acme/app"]),
    );
    assert.equal(deliveries.code, 0);
    assert.equal(deliveries.out, "");

    const poke = await capture(() => dispatchCommand(config, "poke", ["--repo", "acme/app"]));
    assert.equal(poke.code, 0);
    await assert.rejects(
      dispatchCommand(config, "poke", ["--repo", "ghost/none"]),
      /unknown repository ghost\/none/,
    );
  });
});

test("every wait command times out with exit 8 when nothing happens", async () => {
  await withDaemon(["acme/app"], async (config) => {
    const waits: string[][] = [
      ["run", "8", "--timeout", "1s"],
      ["checks", "3", "--timeout", "1s"],
      ["pr", "3", "--until", "merged", "--timeout", "1s"],
      ["pages", "abc123", "--timeout", "1s"],
      ["wait", "--event", "push", "--match", "ref=main", "--match", "note=a=b", "--timeout", "1s"],
    ];
    const results = [];
    for (const args of waits) {
      results.push(await capture(() => dispatchCommand(config, args[0]!, args.slice(1))));
    }

    for (const result of results) {
      assert.equal(result.code, 8, result.err);
      assert.equal(JSON.parse(result.out).reason, "timeout");
    }
  });
});

test("bad arguments are rejected before anything is sent", async () => {
  const two = repoConfig(tempStateDir(), ["a/one", "a/two"]);
  const one = repoConfig(tempStateDir(), ["a/one"]);

  await assert.rejects(dispatchCommand(two, "run", ["7"]), /multiple repositories configured/);
  await assert.rejects(dispatchCommand(one, "run", []), /missing run id/);
  await assert.rejects(dispatchCommand(one, "checks", []), /missing pull request number/);
  await assert.rejects(dispatchCommand(one, "pages", []), /missing commit sha/);
  await assert.rejects(dispatchCommand(one, "pr", ["3"]), /--until must be one of/);
  await assert.rejects(
    dispatchCommand(one, "pr", ["3", "--until", "later"]),
    /--until must be one of/,
  );
  await assert.rejects(dispatchCommand(one, "wait", []), /--event is required/);
  await assert.rejects(
    dispatchCommand(one, "wait", ["--event", "push", "--match", "nokey"]),
    /--match must look like key=value/,
  );
});

test("status prints the quota once a real GitHub client has seen response headers", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "application/json",
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4321",
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
    });
    response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const store = new StateStore(":memory:");
  const gh = new GitHub(
    "token",
    store,
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  );
  await gh.get("/warmup");
  const stateDir = tempStateDir();
  const config = repoConfig(stateDir, ["acme/app"]);
  const previous = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = stateDir;
  const daemon = await startDaemon(config, { gh, watch: false });
  try {
    const result = await capture(() => dispatchCommand(config, "status", []));

    assert.match(result.out, /quota 4321\/5000 remaining, resets \d{4}-/);
  } finally {
    await daemon.close();
    server.close();
    store.close();
    if (previous === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = previous;
  }
});
