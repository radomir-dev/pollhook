#!/usr/bin/env node
import { loadConfig } from "./config.ts";
import { startDaemon } from "./daemon.ts";
import { valueFlag } from "./cli/args.ts";
import { dispatchCommand } from "./cli/commands.ts";
import { brief } from "./cli/format.ts";
import { stream } from "./cli/rpc.ts";
import { USAGE } from "./cli/usage.ts";
import { errorMessage } from "./util.ts";

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }

  const config = loadConfig(valueFlag(args, "--config"));
  if (command === "daemon") {
    const daemon = await startDaemon(config);
    await daemon.closed;
    return 0;
  }
  if (command === "emit") {
    await stream(config, { op: "emit" }, args.includes("--brief") ? brief : undefined);
    return 0;
  }
  return dispatchCommand(config, command, args);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`pollhook: ${errorMessage(error)}\n`);
    process.exitCode = 2;
  },
);
