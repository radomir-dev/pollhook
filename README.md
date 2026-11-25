# pollhook

[![npm](https://img.shields.io/npm/v/pollhook)](https://www.npmjs.com/package/pollhook)
[![ci](https://github.com/radomir-dev/pollhook/actions/workflows/ci.yml/badge.svg)](https://github.com/radomir-dev/pollhook/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/pollhook)](LICENSE)

GitHub webhook deliveries without webhooks. pollhook polls the GitHub REST API with
a read-only token and turns what it sees into GitHub-shaped events, so you can
wait for CI, stream repository activity, or feed a webhook handler without admin
rights, a public URL or a GitHub App.

## Table of contents

<!-- toc:start -->

1. [Install](#install)
1. [Quick start](#quick-start)
1. [What you can do with it](#what-you-can-do-with-it)
1. [Configuration](#configuration)
1. [Run it as a service](#run-it-as-a-service)
1. [Rate limits](#rate-limits)
1. [Reading status](#reading-status)
1. [CLI reference](#cli-reference)
1. [Limits](#limits)
1. [How it compares](#how-it-compares)
1. [Contributing](#contributing)
1. [License](#license)

<!-- toc:end -->

## Install

Node 22.13 or newer is required (the state store uses `node:sqlite`, which is
unflagged from 22.13). Node prints an experimental-SQLite warning that is harmless.

    npm install -g pollhook

or run it without installing: `npx pollhook --help`.

## Quick start

1. Authenticate. pollhook uses `POLLHOOK_TOKEN`, then your `gh auth login`, then
   `GH_TOKEN` or `GITHUB_TOKEN`. A token that can read the repository is enough.
2. Create the config:

        pollhook init --repo owner/name --events workflow_run,pull_request,check_run

   That writes `~/.config/pollhook/config.json` (it refuses to overwrite one without
   `--force`). Add or remove repositories later with `pollhook config add-repo
   owner/name` and `pollhook config remove-repo owner/name`; a running daemon picks
   the change up. `pollhook config check` validates the file and prints the
   resolved interval and strategy of every event.

3. Start the daemon, in a terminal or as a service (see below):

        pollhook daemon

4. In another terminal, wait for things:

        pollhook run 123456789                  # exits 0 on success, 1 on failure
        pollhook checks 42                      # every check on a pull request
        pollhook pr 42 --until merged
        pollhook emit --brief                   # live stream of deliveries

The first poll of each event only records current state, so you never get a replay
of history. A wait on something that already finished returns immediately.

Exit codes for the wait commands: `0` success, `1` the thing failed, `8` timeout,
`2` bad arguments or the daemon is not running.

## What you can do with it

1. **Wait in scripts and agents.** `pollhook run`, `checks`, `pr`, `pages` and
   `wait --event ... --match key=value` block and exit with a meaningful code.
   Any number of waiters share one poller.
2. **Watch a stream.** `pollhook emit` prints one JSON delivery per line;
   `--brief` prints one readable line per delivery. A config edit does not drop the
   stream, and if the daemon restarts or crashes `emit` reconnects with backoff and
   replays what it missed from the local store, printing each delivery once.
3. **Feed a webhook handler.** Set `deliver.url` to a loopback address and pollhook
   POSTs GitHub-shaped requests with `X-GitHub-Event`, `X-GitHub-Delivery` and,
   with a `secret`, a real `X-Hub-Signature-256`.

## Configuration

`~/.config/pollhook/config.json` (override with `--config` or `POLLHOOK_CONFIG`).
The daemon reloads it when the file changes or on `SIGHUP`; a broken edit is
reported as `configError` in `pollhook status` and the old config keeps running.

    {
      "$schema": "https://unpkg.com/pollhook/pollhook.schema.json",
      "intervals": { "workflow_run": 10, "pull_request": 15 },
      "strategies": { "workflow_run": "while-active" },
      "repos": [
        {
          "repo": "owner/name",
          "events": ["workflow_run", "pull_request", "check_run", "status"],
          "intervalSeconds": 60,
          "intervals": { "check_run": 120, "status": 120 }
        }
      ],
      "orgs": [{ "org": "my-org", "events": ["team", "membership"], "intervalSeconds": 300 }],
      "deliver": { "url": "http://127.0.0.1:7345/hook", "secret": "change-me" },
      "stateDir": "~/.local/state/pollhook"
    }

1. **`repos[].events`** lists what to poll. Leave it out and every supported event is
   polled, which costs more requests; list only what you need. `pollhook events`
   shows every event with its minimum interval, and [docs/events.md](docs/events.md)
   documents what each one can and cannot report.
2. **Intervals** resolve per event: the repository's `intervals`, then the global
   `intervals`, then the target's `intervalSeconds` (default 60 for repositories,
   300 for organisations). The adapter's own floor always wins, and no interval
   can be under 5 seconds.
3. **`strategies`** picks `fixed` (default) or `while-active`. With `while-active`
   on `workflow_run`, polling relaxes to 30 seconds while every running workflow is
   still under half of its typical duration.
4. **`orgs`** covers organisation-level events (`team`, `membership`).
5. **`deliver.url`** must be loopback. The control socket is a unix socket at
   `$XDG_RUNTIME_DIR/pollhook.sock`, so pollhook opens no network port.
6. **`$schema`** points editors at [pollhook.schema.json](pollhook.schema.json), which
   autocompletes event names and flags typos while you type. `pollhook init` adds it
   for you, and `pollhook config check` warns about keys pollhook ignores.

## Run it as a service

With systemd, copy [contrib/pollhook.service](contrib/pollhook.service) to
`~/.config/systemd/user/`, make sure `ExecStart` points at your `pollhook`
(`which pollhook`), then:

    systemctl --user daemon-reload
    systemctl --user enable --now pollhook
    journalctl --user -u pollhook -f

The unit keeps your home read-only except `~/.local/state`.

## Rate limits

A `304 Not Modified` does not count against GitHub's limit, and pollhook sends
`If-None-Match` on every poll, so a quiet repository is cheap: a ten-minute soak on
one repository made 485 requests, 135 of them with bodies, about 800 billable per
hour. Every poll is delayed by up to 10% at random, so targets that share an
interval do not hit the API in lockstep. When quota runs low the daemon stretches every interval (3x under 15%
remaining, 10x under 5%) and honours `Retry-After`. `pollhook poke` polls
immediately when you know something just happened.

## Reading status

`pollhook status` prints one line per target:

    owner/repo  events=3  last_poll=...  next_poll=...  last_event=...
    quota 4869/5000 remaining, resets ...
    deliveries 60, waiters 0, pid 1234

`error=` is a transient failure that clears after a clean round. `degraded=` lists
adapters GitHub answered with 403 or 404 (a feature that is disabled, or a token
without access); they retry hourly. `status --json` has the reasons.

## CLI reference

<!-- cli:start -->

| Command | What it does |
| --- | --- |
| `pollhook init [--repo OWNER/NAME]... [--events a,b] [--force] [--config PATH]` | Writes a starter config and refuses to overwrite one. |
| `pollhook config check [--config PATH]` | Validates the config and prints the resolved interval and strategy per event. |
| `pollhook config add-repo OWNER/NAME [--events a,b] [--interval N] [--config PATH]` | Adds a repository to the config; a running daemon reloads it. |
| `pollhook config remove-repo OWNER/NAME [--config PATH]` | Removes a repository from the config. |
| `pollhook daemon [--config PATH]` | Polls GitHub and serves consumers over a unix socket. |
| `pollhook status [--json]` | Shows last and next poll per target, quota, degraded adapters and waiters. |
| `pollhook events` | Lists every implemented event with its polling floor. |
| `pollhook deliveries [--limit N] [--repo OWNER/NAME]` | Prints recent deliveries from the state store. |
| `pollhook emit [--brief]` | Streams deliveries as JSON lines until stopped, reconnecting and replaying after a daemon restart. |
| `pollhook run <run-id> [--repo OWNER/NAME] [--timeout 30m]` | Waits for a workflow run and exits with its conclusion. |
| `pollhook checks <pr> [--repo OWNER/NAME] [--timeout 30m]` | Waits for every check on a pull request's head commit. |
| `pollhook pr <pr> --until merged\|closed\|reviewed\|conflict [--repo OWNER/NAME] [--timeout 30m]` | Waits for a pull request to reach a state. |
| `pollhook pages <sha> [--repo OWNER/NAME] [--timeout 30m]` | Waits for the Pages build of a commit. |
| `pollhook wait --event EVENT [--match key=value]... [--repo OWNER/NAME] [--timeout 30m]` | Waits for any delivery matching an event and optional field matches. |
| `pollhook poke [--repo OWNER/NAME]` | Polls now instead of waiting out the interval. |
| `pollhook cleanup` | Reports that pollhook creates no webhooks. |

Flags:

- `pollhook init`: `--repo OWNER/NAME` repeatable, default a placeholder to edit; `--events a,b` comma-separated event names, default workflow_run,pull_request; `--force` overwrite an existing file; `--config PATH` config file, default ~/.config/pollhook/config.json
- `pollhook config check`: `--config PATH` config file, default ~/.config/pollhook/config.json
- `pollhook config add-repo`: `--events a,b` comma-separated event names, default workflow_run,pull_request; `--interval N` poll interval in seconds; `--config PATH` config file, default ~/.config/pollhook/config.json
- `pollhook config remove-repo`: `--config PATH` config file, default ~/.config/pollhook/config.json
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

## Limits

Polling sees state, and a webhook is a history of transitions, so some things are
permanently different:

1. Transitions that leave no state behind are invisible: an object created and
   deleted between two polls, or a review submitted and dismissed before the next
   poll.
2. Short-lived states can be coalesced. A run may go from `queued` to `completed`
   as a single delivery.
3. `sender` is the authenticated user, not necessarily whoever acted.
4. GitHub App events (`installation*`, `marketplace_purchase`) and GraphQL-only
   state (projects, discussions) are not supported.

pollhook is read-only: it never sends `POST`, `PUT`, `PATCH` or `DELETE` to GitHub,
and nothing listens on a network interface. Deliveries are at-least-once and
de-duplicated by fingerprint.

## How it compares

1. `gh webhook forward` and smee.io relay real events, but need a webhook and admin
   rights, and the webhook stays behind in the repository settings.
2. GitHub App delivery polling needs an App installed on the repository.
3. `gh event listen` is a waitlisted preview.
4. The Events API (`/repos/{owner}/{repo}/events`) has no CI, check or deployment
   events, and GitHub documents its latency as "anywhere from 30s to 6h".

## Contributing

    git clone https://github.com/radomir-dev/pollhook && cd pollhook
    npm ci
    npm run doctor

`doctor` runs types, lint, format, architecture rules, dead-code detection, an
audit, the tests with coverage floors, the generated-docs check, and the build with
a package check. CI runs the same command. Pull request titles must follow
Conventional Commits; releases, the changelog and the npm publish are automated
from them. Open work is in the [issue tracker](https://github.com/radomir-dev/pollhook/issues).

## License

[MIT](LICENSE)
