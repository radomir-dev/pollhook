import { COMMANDS, EXIT_CODES, invocation } from "./spec.ts";

export const USAGE = `pollhook: GitHub webhook deliveries without webhooks

${COMMANDS.map((command) => `  ${invocation(command)}`).join("\n")}

Exit codes: ${EXIT_CODES.map((code) => `${code.flag} ${code.description}`).join(", ")}.
`;
