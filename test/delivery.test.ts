import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import { deliveryHeaders, signatureHeaders } from "../src/delivery.ts";
import type { Delivery } from "../src/types.ts";
import { tempStateDir } from "./helpers.ts";

function configFile(raw: unknown): string {
  const path = join(tempStateDir(), "config.json");
  writeFileSync(path, JSON.stringify(raw));
  return path;
}

test("signature headers are real HMACs of the body", () => {
  const body = '{"action":"completed"}';
  const headers = signatureHeaders(body, "s3cret");
  const expected = createHmac("sha256", "s3cret").update(body).digest("hex");
  assert.equal(headers["x-hub-signature-256"], `sha256=${expected}`);
  assert.match(headers["x-hub-signature"] ?? "", /^sha1=[0-9a-f]{40}$/);
  assert.deepEqual(signatureHeaders(body), {});
});

test("delivery headers carry GitHub's event and delivery identity", () => {
  const delivery: Delivery = {
    id: "11111111-1111-1111-1111-111111111111",
    repo: "acme/app",
    event: "workflow_run",
    action: "completed",
    key: "7",
    payload: { action: "completed", repository: { id: 42 } },
    createdAt: new Date().toISOString(),
    deliveredAt: null,
  };
  const headers = deliveryHeaders(delivery);
  assert.equal(headers["x-github-event"], "workflow_run");
  assert.equal(headers["x-github-delivery"], delivery.id);
  assert.equal(headers["x-github-hook-installation-target-type"], "repository");
  assert.equal(headers["x-github-hook-installation-target-id"], "42");
  assert.equal(headers["content-type"], "application/json");
});

test("config fills defaults and accepts a loopback delivery target", () => {
  const path = configFile({
    repos: [{ repo: "acme/app" }],
    deliver: { url: "http://127.0.0.1:7345/hook", secret: "s3cret" },
  });
  const config = loadConfig(path);
  assert.equal(config.repos.length, 1);
  assert.equal(config.repos[0]!.intervalMs, 60_000);
  assert.ok(config.repos[0]!.events.includes("workflow_run"));
  assert.ok(config.stateDir.endsWith("/.local/state/pollhook"));
  assert.equal(config.deliver?.url, "http://127.0.0.1:7345/hook");
});

test("config refuses to deliver anywhere but loopback", () => {
  const path = configFile({
    repos: [{ repo: "acme/app" }],
    deliver: { url: "https://example.com/hook" },
  });
  assert.throws(() => loadConfig(path), /loopback/);
});

test("config rejects events it cannot poll", () => {
  const path = configFile({ repos: [{ repo: "acme/app", events: ["installation"] }] });
  assert.throws(() => loadConfig(path), /unknown event/);
});

test("config requires owner/name repositories", () => {
  const path = configFile({ repos: [{ repo: "app" }] });
  assert.throws(() => loadConfig(path), /owner\/name/);
});
