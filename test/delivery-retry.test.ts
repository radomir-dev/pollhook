import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "vitest";
import { postDelivery } from "../src/delivery.ts";
import type { Delivery } from "../src/types.ts";

const delivery: Delivery = {
  id: "11111111-1111-1111-1111-111111111111",
  repo: "acme/app",
  event: "workflow_run",
  action: "completed",
  key: "7",
  payload: { action: "completed" },
  createdAt: new Date().toISOString(),
  deliveredAt: null,
};

async function serve(
  statuses: number[],
  run: (url: string, hits: () => number) => Promise<void>,
): Promise<void> {
  let hits = 0;
  const server = createServer((_request, response) => {
    const status = statuses[Math.min(hits, statuses.length - 1)]!;
    hits += 1;
    response.writeHead(status).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(`http://127.0.0.1:${port}/hook`, () => hits);
  } finally {
    server.close();
  }
}

test("a failing target is retried with backoff until it accepts", async () => {
  await serve([500, 500, 204], async (url, hits) => {
    await postDelivery(delivery, { url });
    assert.equal(hits(), 3);
  });
});

test("a rejected delivery is not retried", async () => {
  await serve([400], async (url, hits) => {
    await assert.rejects(postDelivery(delivery, { url }), /delivery rejected with 400/);
    assert.equal(hits(), 1);
  });
});

test("a target that never recovers gives up after five attempts", async () => {
  await serve([503], async (url, hits) => {
    await assert.rejects(postDelivery(delivery, { url }), /delivery failed with 503/);
    assert.equal(hits(), 5);
  });
});
