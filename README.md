# pollhook

GitHub webhook deliveries without webhooks: a local listener that rebuilds them
from the REST API.

pollhook runs as a daemon. It polls the GitHub REST API for the repositories,
organisations and event types you subscribe to, turns observed state changes into
GitHub-shaped deliveries, and POSTs them to a local endpoint. A handler written against GitHub's
webhook contract keeps working; the delivery was reconstructed, not pushed.

## Table of contents

<!-- toc:start -->

1. [Why](#why)
1. [How it works](#how-it-works)
1. [Running](#running)
1. [Service](#service)
1. [CLI reference](#cli-reference)
1. [Reading status](#reading-status)
1. [Scheduling](#scheduling)
1. [Fidelity](#fidelity)
1. [Prior art](#prior-art)
1. [Guarantees](#guarantees)
1. [Status](#status)
1. [Layout](#layout)
1. [Name](#name)

<!-- toc:end -->

## Why

Agents waiting on CI loop `gh run watch`, `gh pr checks` and `gh pr view`. Every
waiter runs its own loop, burns API calls and machine time, and only learns about
an event if it was already watching when the event fired. Nothing local can answer
"tell me when this run finishes, and exit with the right code".

The options that exist today all have a catch:

1. `gh webhook forward` and smee.io deliver real events, but need a webhook on the
   repository, admin rights to create it, and a process that is running while the
   event fires. The webhook stays behind in repository settings (unverified).
2. GitHub App delivery polling (`/app/hook/deliveries`) gives real payloads, but
   needs an App installed on the repository and only covers a short retention
   window. The App receives events whether or not anyone is listening.
3. GitHub Event Streams (`gh event listen`) is a waitlisted preview and answers
   `403 Event subscriptions are not enabled for this account` here.

pollhook takes the fourth path: a read-only token, the REST API, and a local
delivery contract. No admin rights, no public URL, no App, and a wait that returns
immediately for something that already finished.

## How it works

1. One config file lists the repositories and organisations, the event names to
   subscribe to, and the delivery targets.
2. Every event has an adapter: a REST endpoint to read, a cursor field to order
   by, and a mapping from the REST resource to the webhook payload.
3. The scheduler polls with `If-None-Match`. A `304` costs nothing against the
   rate limit, so a quiet repository is close to free.
4. An observed change becomes a delivery carrying `X-GitHub-Event`,
   `X-GitHub-Delivery`, and `X-Hub-Signature-256` when a secret is configured.
   Deliveries are at-least-once; a fingerprint store drops duplicates. A failing
   POST target is retried five times with exponential backoff, while a 4xx answer
   other than 408 or 429 is treated as permanent. The first
   poll of each event records state without delivering, so a cold start never
   replays history.
5. Consumers pick their shape: an optional loopback POST target, a JSONL stream
   (`pollhook emit`), or the wait commands, which block and exit `0` success,
   `1` failure, `8` timeout, `2` bad arguments or daemon unreachable.

The REST resource is the source, not `/repos/{owner}/{repo}/events`. That endpoint
is a lagging feed of repository activity, not a queryable state log, and it cannot
report the current status of a run or a check.

## Running

1. `npm install && npm run build`, then `npm link` to put `pollhook` on PATH.
   Node 24 is required; `.mise.toml` pins 24.22.3.
2. Copy `pollhook.example.json` to `~/.config/pollhook/config.json` and set the
   repository and events. An optional `orgs` array covers org-level events;
   `team` and `membership` are implemented today. `intervals` sets a poll interval
   per event, globally or per repository, and `strategies` picks `fixed` or
   `while-active` per event. A repository's own value wins over the global one,
   which wins over the target's `intervalSeconds`; the adapter floor always wins
   last, so nothing polls faster than the API tolerates.
3. Run `pollhook daemon`. The token comes from `POLLHOOK_TOKEN`, then your
   `gh auth login`, then `GH_TOKEN`/`GITHUB_TOKEN`. The gh login wins over ambient
   tokens because a `GITHUB_TOKEN` in the environment often belongs to something
   else.
4. The daemon reloads `config.json` on `SIGHUP` and when the file changes, so a
   config edit keeps the socket and every open `emit` stream alive. A broken edit
   is reported as `configError` in `status` and the previous config keeps running.
5. Use `pollhook run <id>`, `pollhook checks <pr>`, `pollhook pr <n> --until
   merged`, `pollhook pages <sha>` and `pollhook status`.
6. `pollhook poke [--repo OWNER/NAME]` polls now instead of waiting out the
   interval, which is how a run you just started shows up within a second.
7. `pollhook emit --brief` prints one line per delivery: time, repo, event,
   action, key, then the run or check name, the conclusion when it finished, and
   the elapsed time while it runs. Full JSON stays the default.

The daemon serves consumers over a unix socket at
`$XDG_RUNTIME_DIR/pollhook.sock`, so it opens no port. An optional `deliver.url`
receives GitHub-shaped POSTs and must be a loopback address.

The published package ships `dist/` and a `pollhook` bin, so `npx pollhook` works
once the package is on npm.

## Service

1. `npm link` so `~/.local/bin/pollhook` exists. If your npm global prefix lives
   elsewhere, symlink the bin into `~/.local/bin` or edit `ExecStart`.
2. Copy `contrib/pollhook.service` to `~/.config/systemd/user/`.
3. `systemctl --user daemon-reload && systemctl --user enable --now pollhook`.
4. `journalctl --user -u pollhook -f` to watch it.

The unit keeps the home read-only except `~/.local/state`, and puts the mise shims
on `PATH` so `node` and `gh auth token` resolve.

## CLI reference

<!-- cli:start -->

| Command | What it does |
| --- | --- |
| `pollhook daemon [--config PATH]` | Polls GitHub and serves consumers over a unix socket. |
| `pollhook status [--json]` | Shows last and next poll per target, quota, degraded adapters and waiters. |
| `pollhook events` | Lists every implemented event with its polling floor. |
| `pollhook deliveries [--limit N] [--repo OWNER/NAME]` | Prints recent deliveries from the state store. |
| `pollhook emit [--brief]` | Streams deliveries as JSON lines until stopped. |
| `pollhook run <run-id> [--repo OWNER/NAME] [--timeout 30m]` | Waits for a workflow run and exits with its conclusion. |
| `pollhook checks <pr> [--repo OWNER/NAME] [--timeout 30m]` | Waits for every check on a pull request's head commit. |
| `pollhook pr <pr> --until merged\|closed\|reviewed\|conflict [--repo OWNER/NAME] [--timeout 30m]` | Waits for a pull request to reach a state. |
| `pollhook pages <sha> [--repo OWNER/NAME] [--timeout 30m]` | Waits for the Pages build of a commit. |
| `pollhook wait --event EVENT [--match key=value]... [--repo OWNER/NAME] [--timeout 30m]` | Waits for any delivery matching an event and optional field matches. |
| `pollhook poke [--repo OWNER/NAME]` | Polls now instead of waiting out the interval. |
| `pollhook cleanup` | Reports that pollhook creates no webhooks. |

Flags:

- `pollhook daemon`: `--config PATH` config file, default ~/.config/pollhook/config.json
- `pollhook status`: `--json` prints the raw status body
- `pollhook deliveries`: `--limit N` how many to print, default 20; `--repo OWNER/NAME` targets one repository
- `pollhook emit`: `--brief` one human line per delivery instead of the payload
- `pollhook run`: `--repo OWNER/NAME` targets one repository; `--timeout 30m` how long to wait
- `pollhook checks`: `--repo OWNER/NAME` targets one repository; `--timeout 30m` how long to wait
- `pollhook pr`: `--until STATE` merged, closed, reviewed or conflict; `--repo OWNER/NAME` targets one repository; `--timeout 30m` how long to wait
- `pollhook pages`: `--repo OWNER/NAME` targets one repository; `--timeout 30m` how long to wait
- `pollhook wait`: `--event EVENT` event name, see `pollhook events`; `--match key=value` repeatable top-level field match; `--repo OWNER/NAME` targets one repository; `--timeout 30m` how long to wait
- `pollhook poke`: `--repo OWNER/NAME` targets one repository

Exit codes: `0` success, `1` the waited-on run, check set or pull request failed, `8` timeout, `2` bad input or daemon unreachable.

<!-- cli:end -->

## Reading status

`pollhook status` prints one line per target:

    owner/repo  events=33  last_poll=...  next_poll=...  last_event=...
    quota 4869/5000 remaining, resets ...
    deliveries 60, waiters 0, pid 1234

1. `last_poll` is the last completed round; `next_poll` is the earliest adapter
   due for that target.
2. `last_event` is the last delivery for the target.
3. `error=` is a transient failure and disappears after a clean round.
4. `degraded=` lists adapters that answered 403 or 404. They retry after an hour
   and drop off the list when a retry succeeds.
5. `status --json` prints the same body with the per-adapter degraded reasons.

## Scheduling

Each adapter polls on its resolved interval, never faster than its own floor:
the repository's `intervals` entry, then the global one, then the target's
`intervalSeconds`. With `strategies: { "workflow_run": "while-active" }` the daemon
keeps the last twenty durations of every workflow and polls `workflow_run` every
30 seconds instead of the configured interval while every running workflow is
still under half its typical duration, so a finished run is reported within one
slow round and a quiet repository still gets the fast interval. The default
strategy is `fixed`. Durations come from runs already fetched, so the estimate
costs no requests. When quota is short the daemon multiplies every interval by 3
under 15% remaining and by 10 under 5%, and a `Retry-After` on a 403 or 429 is
honoured before the next attempt.

## Fidelity

Polling sees state; webhooks are a history of transitions. Four consequences, all
of them permanent:

1. Transitions that leave no state behind are invisible: an object created and
   deleted between two polls, a `repository_dispatch` call, a review submitted
   and dismissed before the next poll.
2. Intermediate states can be coalesced. A run may go from `queued` straight to
   `completed` if it is short, and you will see one delivery instead of three.
3. `sender` is the authenticated user or `ghost`, not necessarily the person who
   acted. The REST API rarely records the actor.
4. Some events exist only for GitHub Apps (`installation*`,
   `github_app_authorization`) and some state is GraphQL-only (projects,
   discussions).

Per-event fidelity is documented in [docs/events.md](docs/events.md): which fields
are guaranteed, which are inferred, and which transitions are undetectable.

## Prior art

1. `gh webhook forward` / smee.io: real deliveries over a relay. Needs a webhook,
   has no history, and has no wait primitive.
2. `gr2m/github-app-webhook-relay-polling`: polls an App's deliveries endpoint.
   Exact payloads, but needs an App and only sees the retention window.
3. `daveseco7/polling-to-webhook`: generic poll-and-POST. No GitHub payload
   semantics, no cursor, no dedupe.
4. Probot `receive`: replays saved payloads. Not live.
5. `github-event-poller`, Huginn and n8n recipes over `/users/{username}/events`:
   convenient ETag polling, but the feed carries 16 activity types and none of them
   is CI, checks, Pages or deployments, and GitHub's own docs warn that event
   latency is "anywhere from 30s to 6h". It can accelerate activity events; it
   cannot answer a wait.

The bet here is narrower than "emulate GitHub": a read-only token is the lowest
possible bar, and a wait command with meaningful exit codes is the contract an
agent actually needs. Event synthesis is the mechanism, not the product.

## Guarantees

1. Read-only. pollhook never sends `POST`, `PUT`, `PATCH` or `DELETE` to GitHub.
2. The control socket is a unix socket, and `deliver.url` must be loopback.
   Nothing listens on a network interface.
3. Deliveries are verifiable: with a secret configured, `X-Hub-Signature-256` is
   a real HMAC of the body, so consumers validate exactly as they do for GitHub.
4. A waiting command reads current state before it subscribes, so a run that
   finished before the command started returns instantly.
5. Payload compatibility is per field and documented, not byte-for-byte. Unknown
   fields pass through when the REST object carries them.

## Status

P0, P1, most of P2 and P3, and the deployment and protection events are
implemented and covered by 141 tests. What shipped and what comes next is in
[PROGRESS.md](PROGRESS.md); phases and acceptance criteria are in
[the issue tracker](https://github.com/radomir-dev/pollhook/issues).

## Layout

1. `PROGRESS.md`: what each change did, what was measured and how it was verified.
2. `docs/events.md`: the event catalog with REST source, cursor, fidelity and phase.
3. `pollhook.example.json`: a starting config.
4. `contrib/pollhook.service`: the systemd user unit.

## Name

poll + hook. The npm name is free, and no active project uses it.
