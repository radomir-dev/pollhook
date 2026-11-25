const isSqliteNotice = (type: unknown, message: unknown): boolean =>
  type === "ExperimentalWarning" && String(message).includes("SQLite");

const emitWarning = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const options = args[0] as string | { type?: string } | undefined;
  const type = typeof options === "string" ? options : options?.type;
  if (
    isSqliteNotice(
      type ?? (warning as Error).name,
      warning instanceof Error ? warning.message : warning,
    )
  )
    return;
  return (emitWarning as (...all: unknown[]) => void).call(process, warning, ...args);
}) as typeof process.emitWarning;

const defaults = process.listeners("warning");
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (isSqliteNotice(warning.name, warning.message)) return;
  for (const listener of defaults) listener(warning);
});
