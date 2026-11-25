import type { Delivery } from "../types.ts";

export function brief(delivery: Delivery): string {
  const time = new Date(delivery.createdAt).toTimeString().slice(0, 8);
  return [time, delivery.repo, delivery.event, delivery.action, delivery.key]
    .filter(Boolean)
    .join(" ");
}
