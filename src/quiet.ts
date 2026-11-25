const emitWarning = process.emitWarning;

process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
  const options = args[0] as string | { type?: string } | undefined;
  const type = typeof options === "string" ? options : options?.type;
  if (type === "ExperimentalWarning" && String(warning).includes("SQLite")) return;
  return (emitWarning as (...all: unknown[]) => void).call(process, warning, ...args);
}) as typeof process.emitWarning;
