import type { EventName } from "../types.ts";

export type Strategy = "fixed" | "while-active";

export interface EventTuning {
  intervals?: Partial<Record<EventName, number>>;
  strategies?: Partial<Record<EventName, Strategy>>;
}

const STRATEGIES = new Set<string>(["fixed", "while-active"]);

export function parseTuning(
  value: any,
  path: string,
  label: string,
  allowed: EventName[],
): EventTuning {
  const intervals = parseIntervals(value.intervals, path, label, allowed);
  const strategies = parseStrategies(value.strategies, path, label, allowed);
  return { ...(intervals ? { intervals } : {}), ...(strategies ? { strategies } : {}) };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseIntervals(
  value: unknown,
  path: string,
  label: string,
  allowed: EventName[],
): Partial<Record<EventName, number>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`config ${path}: ${label}.intervals must be an object`);
  const intervals: Partial<Record<EventName, number>> = {};
  for (const [event, seconds] of Object.entries(value)) {
    if (!allowed.includes(event as EventName)) {
      throw new Error(`config ${path}: ${label}.intervals.${event} is not a subscribed event`);
    }
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
      throw new Error(`config ${path}: ${label}.intervals.${event} must be a number of seconds`);
    }
    const parsed = seconds;
    if (parsed < 5) {
      throw new Error(`config ${path}: ${label}.intervals.${event} must be at least 5 seconds`);
    }
    intervals[event as EventName] = parsed * 1000;
  }
  return Object.keys(intervals).length > 0 ? intervals : undefined;
}

function parseStrategies(
  value: unknown,
  path: string,
  label: string,
  allowed: EventName[],
): Partial<Record<EventName, Strategy>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`config ${path}: ${label}.strategies must be an object`);
  const strategies: Partial<Record<EventName, Strategy>> = {};
  for (const [event, strategy] of Object.entries(value)) {
    if (!allowed.includes(event as EventName)) {
      throw new Error(`config ${path}: ${label}.strategies.${event} is not a subscribed event`);
    }
    if (typeof strategy !== "string" || !STRATEGIES.has(strategy)) {
      throw new Error(`config ${path}: ${label}.strategies.${event} must be fixed or while-active`);
    }
    strategies[event as EventName] = strategy as Strategy;
  }
  return Object.keys(strategies).length > 0 ? strategies : undefined;
}
