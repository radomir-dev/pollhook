import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { StateStore } from "../src/db.ts";
import { GitHub } from "../src/github.ts";

async function withServer(
  handler: (request: any, response: any) => void,
  run: (gh: GitHub, hits: string[]) => Promise<void>,
): Promise<void> {
  const hits: string[] = [];
  const server = createServer((request, response) => {
    hits.push(String(request.url));
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const db = new StateStore(":memory:");
  const gh = new GitHub("token", db, `http://127.0.0.1:${port}`);
  try {
    await run(gh, hits);
  } finally {
    server.close();
    db.close();
  }
}

test("remaining quota drives the interval pressure", async () => {
  const header = (remaining: number) => ({
    limit: 5000,
    remaining,
    reset: String(Math.floor(Date.now() / 1000) + 3600),
  });
  let quota = header(4000);

  await withServer(
    (_request, response) => {
      response.writeHead(200, {
        "content-type": "application/json",
        "x-ratelimit-limit": String(quota.limit),
        "x-ratelimit-remaining": String(quota.remaining),
        "x-ratelimit-reset": quota.reset,
      });
      response.end("{}");
    },
    async (gh) => {
      await gh.get("/thing");
      assert.equal(gh.pressure(), 1);

      quota = header(600);
      await gh.get("/thing");
      assert.equal(gh.pressure(), 3);

      quota = header(100);
      await gh.get("/thing");
      assert.equal(gh.pressure(), 10);
    },
  );
});

test("a secondary rate limit honours retry-after before the next attempt", async () => {
  let calls = 0;

  await withServer(
    (_request, response) => {
      calls += 1;
      if (calls === 1) {
        response.writeHead(403, { "retry-after": "1", "content-type": "application/json" });
        response.end('{"message":"secondary rate limit"}');
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true}');
    },
    async (gh, hits) => {
      const started = Date.now();
      const result = await gh.get<{ ok: boolean }>("/thing");

      assert.equal(result.data?.ok, true);
      assert.equal(hits.length, 2);
      assert.ok(Date.now() - started >= 1000, "waited for retry-after");
    },
  );
});
