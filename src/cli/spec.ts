export interface FlagSpec {
  flag: string;
  description: string;
}

export interface CommandSpec {
  name: string;
  args: string;
  summary: string;
  flags?: FlagSpec[];
}

export const EXIT_CODES: FlagSpec[] = [
  { flag: "0", description: "success" },
  { flag: "1", description: "the waited-on run, check set or pull request failed" },
  { flag: "8", description: "timeout" },
  { flag: "2", description: "bad input or daemon unreachable" },
];

const REPO: FlagSpec = { flag: "--repo OWNER/NAME", description: "targets one repository" };
const TIMEOUT: FlagSpec = { flag: "--timeout 30m", description: "how long to wait" };

export const COMMANDS: CommandSpec[] = [
  {
    name: "daemon",
    args: "[--config PATH]",
    summary: "Polls GitHub and serves consumers over a unix socket.",
    flags: [
      { flag: "--config PATH", description: "config file, default ~/.config/pollhook/config.json" },
    ],
  },
  {
    name: "status",
    args: "[--json]",
    summary: "Shows last and next poll per target, quota, degraded adapters and waiters.",
    flags: [{ flag: "--json", description: "prints the raw status body" }],
  },
  { name: "events", args: "", summary: "Lists every implemented event with its polling floor." },
  {
    name: "deliveries",
    args: "[--limit N] [--repo OWNER/NAME]",
    summary: "Prints recent deliveries from the state store.",
    flags: [{ flag: "--limit N", description: "how many to print, default 20" }, REPO],
  },
  {
    name: "emit",
    args: "[--brief]",
    summary: "Streams deliveries as JSON lines until stopped.",
    flags: [{ flag: "--brief", description: "one human line per delivery instead of the payload" }],
  },
  {
    name: "run",
    args: "<run-id> [--repo OWNER/NAME] [--timeout 30m]",
    summary: "Waits for a workflow run and exits with its conclusion.",
    flags: [REPO, TIMEOUT],
  },
  {
    name: "checks",
    args: "<pr> [--repo OWNER/NAME] [--timeout 30m]",
    summary: "Waits for every check on a pull request's head commit.",
    flags: [REPO, TIMEOUT],
  },
  {
    name: "pr",
    args: "<pr> --until merged|closed|reviewed|conflict [--repo OWNER/NAME] [--timeout 30m]",
    summary: "Waits for a pull request to reach a state.",
    flags: [
      { flag: "--until STATE", description: "merged, closed, reviewed or conflict" },
      REPO,
      TIMEOUT,
    ],
  },
  {
    name: "pages",
    args: "<sha> [--repo OWNER/NAME] [--timeout 30m]",
    summary: "Waits for the Pages build of a commit.",
    flags: [REPO, TIMEOUT],
  },
  {
    name: "wait",
    args: "--event EVENT [--match key=value]... [--repo OWNER/NAME] [--timeout 30m]",
    summary: "Waits for any delivery matching an event and optional field matches.",
    flags: [
      { flag: "--event EVENT", description: "event name, see `pollhook events`" },
      { flag: "--match key=value", description: "repeatable top-level field match" },
      REPO,
      TIMEOUT,
    ],
  },
  {
    name: "poke",
    args: "[--repo OWNER/NAME]",
    summary: "Polls now instead of waiting out the interval.",
    flags: [REPO],
  },
  { name: "cleanup", args: "", summary: "Reports that pollhook creates no webhooks." },
];

export function invocation(command: CommandSpec): string {
  return ["pollhook", command.name, command.args].filter(Boolean).join(" ");
}
