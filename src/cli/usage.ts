export const USAGE = `pollhook: GitHub webhook deliveries without webhooks

  pollhook daemon [--config PATH]
  pollhook status [--json]
  pollhook events
  pollhook deliveries [--limit N] [--repo OWNER/NAME]
  pollhook emit [--brief]
  pollhook run <run-id> [--repo OWNER/NAME] [--timeout 30m]
  pollhook checks <pr> [--repo OWNER/NAME] [--timeout 30m]
  pollhook pr <pr> --until merged|closed|reviewed|conflict [--repo OWNER/NAME] [--timeout 30m]
  pollhook pages <sha> [--repo OWNER/NAME] [--timeout 30m]
  pollhook wait --event EVENT [--match key=value]... [--repo OWNER/NAME] [--timeout 30m]
  pollhook poke [--repo OWNER/NAME]
  pollhook cleanup

Exit codes: 0 success, 1 failing conclusion, 8 timeout, 2 bad input or daemon unreachable.
`;
