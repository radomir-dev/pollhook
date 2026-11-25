import { COMMANDS, EXIT_CODES, invocation } from "./spec.ts";

export const START = "<!-- cli:start -->";
export const END = "<!-- cli:end -->";

function cell(text: string): string {
  return text.replaceAll("|", "\\|");
}

export function cliMarkdown(): string {
  const lines = [START, "", "| Command | What it does |", "| --- | --- |"];
  for (const command of COMMANDS) {
    lines.push(`| \`${cell(invocation(command))}\` | ${cell(command.summary)} |`);
  }
  lines.push("", "Flags:", "");
  for (const command of COMMANDS) {
    if (!command.flags?.length) continue;
    lines.push(`- \`pollhook ${command.name}\`: ${command.flags.map((flag) => `\`${flag.flag}\` ${flag.description}`).join("; ")}`);
  }
  lines.push("", `Exit codes: ${EXIT_CODES.map((code) => `\`${code.flag}\` ${code.description}`).join(", ")}.`, "", END);
  return lines.join("\n");
}

export function replaceSection(readme: string, block: string): string {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start < 0 || end < start) throw new Error(`README is missing the ${START} ... ${END} markers`);
  return `${readme.slice(0, start)}${block}${readme.slice(end + END.length)}`;
}
