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

export async function postDelivery(delivery: Delivery, target: DeliverConfig): Promise<void> {
  const body = JSON.stringify(delivery.payload);
  for (const attempt of [0, 1]) {
    try {
      const response = await fetch(target.url, {
        method: "POST",
        headers: deliveryHeaders(delivery, target.secret),
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) return;
      if (response.status < 500) throw new Error(`delivery rejected with ${response.status}`);
      if (attempt === 1) throw new Error(`delivery failed with ${response.status}`);
    } catch (error) {
      if (attempt === 1) throw error;
      await sleep(500);
    }
  }
}
