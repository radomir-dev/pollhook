import { createHmac } from "node:crypto";
import type { DeliverConfig } from "./config.ts";
import type { Delivery } from "./types.ts";
import { sleep } from "./util.ts";

export function signatureHeaders(body: string, secret?: string): Record<string, string> {
  if (!secret) return {};
  return {
    "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    "x-hub-signature": `sha1=${createHmac("sha1", secret).update(body).digest("hex")}`,
  };
}

export function deliveryHeaders(delivery: Delivery, secret?: string): Record<string, string> {
  const body = JSON.stringify(delivery.payload);
  return {
    "content-type": "application/json",
    "user-agent": "pollhook/0.1.0",
    "x-github-event": delivery.event,
    "x-github-delivery": delivery.id,
    "x-github-hook-id": "pollhook",
    "x-github-hook-installation-target-type": "repository",
    "x-github-hook-installation-target-id": String(
      (delivery.payload.repository as { id?: number } | undefined)?.id ?? "",
    ),
    ...signatureHeaders(body, secret),
  };
}

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 500;

class Rejected extends Error {}

export async function postDelivery(delivery: Delivery, target: DeliverConfig): Promise<void> {
  const body = JSON.stringify(delivery.payload);
  let lastError: unknown = new Error("delivery was never attempted");
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(target.url, {
        method: "POST",
        headers: deliveryHeaders(delivery, target.secret),
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) return;
      if (!isRetryable(response.status)) throw new Rejected(`delivery rejected with ${response.status}`);
      lastError = new Error(`delivery failed with ${response.status}`);
    } catch (error) {
      if (error instanceof Rejected) throw new Error(error.message);
      lastError = error;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
  }
  throw lastError;
}

function isRetryable(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}
