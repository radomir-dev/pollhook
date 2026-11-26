const VALUE_FLAGS = new Set([
  "--config",
  "--repo",
  "--timeout",
  "--until",
  "--limit",
  "--event",
  "--match",
  "--events",
  "--interval",
  "--idle-exit",
]);

export function valueFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function values(args: string[], name: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === name && args[index + 1] !== undefined) result.push(args[index + 1]!);
  }
  return result;
}

export function positionals(args: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (VALUE_FLAGS.has(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) continue;
    result.push(arg);
  }
  return result;
}

export function parseDuration(value: string | undefined, fallbackMs: number): number {
  if (!value) return fallbackMs;
  const match = /^(\d+)(s|m|h)?$/.exec(value);
  if (!match) throw new Error(`invalid --timeout ${value}`);
  const amount = Number(match[1]);
  const unit = match[2] ?? "s";
  if (unit === "h") return amount * 3_600_000;
  if (unit === "m") return amount * 60_000;
  return amount * 1000;
}

export function required<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === "") throw new Error(`missing ${name}`);
  return value;
}
