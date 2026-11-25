import type { Delivery } from "../types.ts";
import { formatDuration } from "../util.ts";

const NAME_LIMIT = 40;

export function brief(delivery: Delivery): string {
  const time = new Date(delivery.createdAt).toTimeString().slice(0, 8);
  return [time, delivery.repo, delivery.event, delivery.action, delivery.key, ...details(delivery)]
    .filter(Boolean)
    .join(" ");
}

function details(delivery: Delivery): string[] {
  const subject = (delivery.payload?.[delivery.event] ?? {}) as Record<string, any>;
  const name = truncate(subject.name ?? subject.display_title ?? subject.title);
  const conclusion = delivery.action === "completed" ? subject.conclusion : null;
  const started = subject.run_started_at ?? subject.started_at;
  const elapsed =
    delivery.action === "in_progress" && typeof started === "string"
      ? formatDuration(Date.now() - Date.parse(started))
      : null;
  return [name, conclusion, elapsed].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

function truncate(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.length > NAME_LIMIT ? `${value.slice(0, NAME_LIMIT - 1)}…` : value;
}
