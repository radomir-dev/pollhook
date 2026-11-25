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
    lines.push(
      `- \`pollhook ${command.name}\`: ${command.flags.map((flag) => `\`${flag.flag}\` ${flag.description}`).join("; ")}`,
    );
  }
  lines.push(
    "",
    `Exit codes: ${EXIT_CODES.map((code) => `\`${code.flag}\` ${code.description}`).join(", ")}.`,
    "",
    END,
  );
  return lines.join("\n");
}

export function replaceSection(readme: string, block: string): string {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start < 0 || end < start)
    throw new Error(`README is missing the ${START} ... ${END} markers`);
  return `${readme.slice(0, start)}${block}${readme.slice(end + END.length)}`;
}

const TOC_START = "<!-- toc:start -->";
const TOC_END = "<!-- toc:end -->";

export function tocMarkdown(readme: string): string {
  const lines = [TOC_START, ""];
  for (const heading of readme.matchAll(/^## (.+)$/gm)) {
    const title = heading[1]!.trim();
    if (title.toLowerCase() === "table of contents") continue;
    lines.push(`1. [${title}](#${slug(title)})`);
  }
  lines.push("", TOC_END);
  return lines.join("\n");
}

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function replaceToc(readme: string): string {
  const start = readme.indexOf(TOC_START);
  const end = readme.indexOf(TOC_END);
  if (start < 0 || end < start)
    throw new Error(`README is missing the ${TOC_START} ... ${TOC_END} markers`);
  const block = tocMarkdown(readme);
  return `${readme.slice(0, start)}${block}${readme.slice(end + TOC_END.length)}`;
}
