#!/usr/bin/env node
import "./quiet.ts";
import { configPath, loadConfig } from "./config.ts";
import { startDaemon } from "./daemon.ts";
import { parseDuration, valueFlag } from "./cli/args.ts";
import { runConfigCommand } from "./cli/config-commands.ts";
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

  const handled = runConfigCommand(command, args);
  if (handled !== undefined) return handled;

  if (args.includes("--no-autostart")) process.env.POLLHOOK_NO_AUTOSTART = "1";
  const configFile = configPath(valueFlag(args, "--config"));
  process.env.POLLHOOK_CONFIG = configFile;
  const config = loadConfig(configFile);
  if (command === "daemon") {
    const idle = valueFlag(args, "--idle-exit");
    const daemon = await startDaemon(config, {
      idleExitMs: idle ? parseDuration(idle, 0) : undefined,
    });
    await daemon.closed;
    process.exit(0);
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
