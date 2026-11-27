import { implementedEvents } from "../registry.ts";
import { PACKAGE_TYPES } from "../types.ts";
import type { EventName } from "../types.ts";
import { MIN_INTERVAL_SECONDS } from "./help.ts";

type Schema = Record<string, any>;

export const SCHEMA_URL = "https://unpkg.com/pollhook/pollhook.schema.json";

const interval = (description: string): Schema => ({
  type: "number",
  minimum: MIN_INTERVAL_SECONDS,
  description,
});

function intervals(events: EventName[]): Schema {
  const properties = Object.fromEntries(
    events.map((event) => [event, interval(`Seconds between ${event} polls`)]),
  );
  return {
    type: "object",
    description: "Poll interval per event; the adapter's own floor still applies.",
    properties,
    additionalProperties: false,
  };
}

function strategies(events: EventName[]): Schema {
  const properties = Object.fromEntries(
    events.map((event) => [event, { enum: ["fixed", "while-active"] }]),
  );
  return {
    type: "object",
    description: "fixed (default) or while-active, which relaxes polling while runs are early.",
    properties,
    additionalProperties: false,
  };
}

function eventList(events: EventName[]): Schema {
  return { type: "array", minItems: 1, uniqueItems: true, items: { enum: events } };
}

function repoSchema(events: EventName[]): Schema {
  return {
    type: "object",
    required: ["repo"],
    additionalProperties: false,
    properties: {
      repo: { type: "string", pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$" },
      events: eventList(events),
      intervalSeconds: { ...interval("Default seconds between polls, 60 if unset") },
      checkRefLimit: { type: "number", exclusiveMinimum: 0, description: "Refs polled for checks" },
      intervals: intervals(events),
      strategies: strategies(events),
    },
  };
}

function orgSchema(events: EventName[]): Schema {
  return {
    type: "object",
    required: ["org"],
    additionalProperties: false,
    properties: {
      org: { type: "string", pattern: "^[A-Za-z0-9_.-]+$" },
      events: eventList(events),
      intervalSeconds: { ...interval("Default seconds between polls, 300 if unset") },
      packageTypes: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { enum: [...PACKAGE_TYPES] },
        description: "Package types polled for package events; all six if unset",
      },
      intervals: intervals(events),
      strategies: strategies(events),
    },
  };
}

export function configSchema(): Schema {
  const repoEvents = implementedEvents("repo");
  const orgEvents = implementedEvents("org");
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "pollhook config",
    type: "object",
    additionalProperties: false,
    properties: {
      $schema: { type: "string" },
      repos: { type: "array", items: repoSchema(repoEvents) },
      orgs: { type: "array", items: orgSchema(orgEvents) },
      intervals: intervals(repoEvents),
      strategies: strategies(repoEvents),
      deliver: {
        type: "object",
        required: ["url"],
        additionalProperties: false,
        properties: {
          url: {
            type: "string",
            pattern: "^https?://(127\\.0\\.0\\.1|localhost|\\[::1\\])(:\\d+)?(/.*)?$",
          },
          secret: { type: "string" },
        },
      },
      stateDir: { type: "string", description: "Default ~/.local/state/pollhook" },
    },
  };
}

export function findUnknownKeys(raw: Record<string, any>): string[] {
  const schema = configSchema();
  const unknown = Object.keys(raw).filter((key) => !(key in schema.properties));
  const groups: Array<[string, Schema]> = [
    ["repos", schema.properties.repos.items],
    ["orgs", schema.properties.orgs.items],
  ];
  for (const [name, item] of groups) {
    for (const [index, entry] of (Array.isArray(raw[name]) ? raw[name] : []).entries()) {
      for (const key of Object.keys(entry ?? {})) {
        if (!(key in item.properties)) unknown.push(`${name}[${index}].${key}`);
      }
    }
  }
  return unknown;
}
