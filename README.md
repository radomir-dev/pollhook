# pollhook

GitHub webhook deliveries without webhooks: a local listener that rebuilds them
from the REST API.

pollhook runs as a daemon. It polls the GitHub REST API for the repositories,
organisations and event types you subscribe to, turns observed state changes into
GitHub-shaped deliveries, and POSTs them to a local endpoint. A handler written against GitHub's
webhook contract keeps working; the delivery was reconstructed, not pushed.

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
   Deliveries are at-least-once; a fingerprint store drops duplicates. The first
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
4. Use `pollhook run <id>`, `pollhook checks <pr>`, `pollhook pr <n> --until
   merged`, `pollhook pages <sha>` and `pollhook status`.
5. `pollhook poke [--repo OWNER/NAME]` polls now instead of waiting out the
   interval, which is how a run you just started shows up within a second.
6. `pollhook emit --brief` prints one line per delivery: time, repo, event,
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

P0, P1, most of P2, most of P3 and the first P4 events are implemented and
covered by 82 tests. What shipped and what comes next is in
[PROGRESS.md](PROGRESS.md); phases and acceptance criteria are in
[AGENDA.md](AGENDA.md).

## Layout

1. `AGENDA.md`: phases, acceptance criteria, decisions and open questions.
2. `PROGRESS.md`: what is done, what was measured, what is next.
3. `docs/events.md`: the event catalog with REST source, cursor, fidelity and phase.
4. `pollhook.example.json`: a starting config.
5. `contrib/pollhook.service`: the systemd user unit.

## Name

poll + hook. The npm name is free, and no active project uses it.
