export const EVENTS_DOC_URL = "https://github.com/radomir-dev/pollhook/blob/main/docs/events.md";
export const MIN_INTERVAL_SECONDS = 5;

export function missingConfigMessage(path: string): string {
  return [
    `no config at ${path}`,
    "Create one with `pollhook init --repo OWNER/NAME`, or point at another file with --config PATH or POLLHOOK_CONFIG.",
    'A minimal config: { "repos": [{ "repo": "owner/name", "events": ["workflow_run"] }] }',
  ].join("\n");
}
