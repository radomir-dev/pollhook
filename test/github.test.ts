import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { StateStore } from "../src/db.ts";
import { GitHub } from "../src/github.ts";

test("conditional requests revalidate, count and persist the etag", async () => {
  const server = createServer((request, response) => {
    if (request.headers["if-none-match"] === '"v1"') {
      response.writeHead(304, { etag: '"v1"' }).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json", etag: '"v1"' });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const db = new StateStore(":memory:");
  const gh = new GitHub("token", db, `http://127.0.0.1:${port}`);
  try {
    const first = await gh.get<{ ok: boolean }>("/thing", { etagKey: "etag:thing" });
    assert.equal(first.notModified, false);
    assert.equal(first.data?.ok, true);

    const second = await gh.get<{ ok: boolean }>("/thing", { etagKey: "etag:thing" });
    assert.equal(second.notModified, true);
    assert.deepEqual(gh.stats, { requests: 2, notModified: 1 });
    assert.equal(db.getCursor("etag:thing")?.etag, '"v1"');
  } finally {
    server.close();
    db.close();
  }
});
