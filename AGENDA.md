# Agenda

When this will be ready I will want to be able to install it from npm or run via npx.

Target for v1: an agent can block on "this run finished", "these checks passed",
"this PR merged" and "Pages built this commit", through one local contract, with no
webhook on the repository and no admin rights. Later phases widen the event surface
toward the 76 events in GitHub's catalog without changing the delivery format.

Status: P0, P1, most of P2 (`push`, `create`, `delete`, `issues`,
`issue_comment`, `release`, `label`, `milestone`, `repository`, `public`, `fork`,
`commit_comment`, `workflow_dispatch`, `merge_group`), most of P3 (`dependabot`,
`code_scanning`, `secret_scanning`, `deployment`, `deployment_status`,
`deploy_key`, `repository_ruleset`, `repository_advisory`,
`repository_vulnerability_alert`, `security_and_analysis`,
`branch_protection_configuration`, `member`, `team`, `membership`) are implemented,
and the
config accepts org targets; see [PROGRESS.md](PROGRESS.md). The phases below remain the plan for everything else.

## Principles

1. State, not history. Every delivery is a reconstruction of an observable
   transition, and docs/events.md says which transitions are observable.
2. One pipeline, two sources. `gh webhook forward` deliveries, when available, and
   polled observations enter the same normalizer and leave as identical deliveries.
   A consumer cannot tell which source woke it.
3. Read the state first, then block. No wait command relies on catching an event.
4. Read-only against GitHub, always.
5. Budget first. Conditional requests, one poller per repository, a governor that
   backs off at 10% remaining quota.
6. Payload compatibility per field, not byte equality.

## P0: skeleton

1. Config at `~/.config/pollhook/config.json`: repositories, event subscriptions,
   delivery targets, poll intervals, secret.
2. State in SQLite (`node:sqlite`): observed objects, cursors, ETags, delivery log,
   dedupe fingerprints.
3. Scheduler: per-endpoint interval, jitter, ETag cache, quota governor, one
   in-flight request per endpoint.
4. Delivery engine: loopback HTTP POST, GitHub headers, optional HMAC signature,
   retry with backoff, at-least-once plus fingerprint dedupe.
5. JSONL sink: `pollhook emit` prints deliveries to stdout, one JSON object per line.
6. CLI shell: `pollhook daemon`, `status`, `events`, `emit`.

Acceptance: a fixture event reaches a local handler with GitHub's headers; a
restart after a delivered event does not deliver it twice; `pollhook events` lists
every subscription with phase and fidelity.

## P1: CI and PR waits

Events: `workflow_run`, `workflow_job`, `check_suite`, `check_run`, `status`,
`pull_request`, `pull_request_review`, `page_build`.

Commands: `pollhook run <id>`, `checks <pr>`, `pr <n> --until merged|closed|
reviewed|conflict`, `pages <sha>`, `wait --event E --match k=v`.

Acceptance, carried over from the original brief:

1. A run in progress returns when it completes, with the exit code matching the
   conclusion.
2. Kill the forwarder, let the run finish, restart: the poll path still returns
   the right answer.
3. Two waiters on one run both return, behind a single poller.
4. `status` shows a stopped forwarder as degraded within one interval.
5. A run that finished before the command started returns instantly.
6. Idle cost on a quiet repository stays under 100 requests per hour.

## P2: repository activity

Events: `push`, `create`, `delete`, `issues`, `issue_comment`,
`pull_request_review_comment`, `commit_comment`, `release`, `label`, `milestone`,
`public`, `repository`, `fork`, `watch`, `star`, `workflow_dispatch`,
`merge_group`. Done: `push` from `/compare`, `create` and `delete` from ref diffs,
`issues`, `issue_comment`, `release`, `label`, `milestone`, `repository`,
`public`, `fork`, `commit_comment`, `workflow_dispatch`, `merge_group`.
`watch` and `star` stay deferred: no cursor, whole-list scans, false positives on
large repositories.

Acceptance: a `push` payload assembled from `/compare` matches GitHub's fields for
`before`, `after`, `commits` and `forced`; opened, closed and reopened across three
separate polls produce three deliveries in order; an object deleted and recreated
between polls is documented as undetectable rather than silently lost.

## P3: security and repository configuration

Events: `dependabot_alert`, `code_scanning_alert`, `secret_scanning_alert`,
`secret_scanning_alert_location`, `secret_scanning_scan`, `repository_advisory`,
`repository_vulnerability_alert`, `security_and_analysis`,
`branch_protection_rule`, `branch_protection_configuration`,
`repository_ruleset`, `deploy_key`, `repository_import`, `sub_issues`,
`deployment`, `deployment_status`, `deployment_review`,
`deployment_protection_rule`.

Acceptance: dismissing a Dependabot alert emits `dismissed` with
`dismissed_reason`; a ruleset edit diffs to `edited`; a missing token scope fails
loudly at subscription time instead of producing silence.

## P4: organisation, projects and apps

Events: `member`, `membership`, `team`, `team_add`, `organization`, `org_block`,
`personal_access_token_request`, `custom_property`, `custom_property_values`,
`projects_v2`, `projects_v2_item`, `projects_v2_status_update`, `project`,
`project_card`, `project_column`, `package`, `registry_package`, `discussion`,
`discussion_comment`, `pull_request_review_thread`, `issue_dependencies`,
`issue_relates_to`, `gollum`, `meta`, `security_advisory`,
`installation`, `installation_repositories`, `installation_target`,
`github_app_authorization`, `marketplace_purchase`, `sponsorship`.

Acceptance: GraphQL-backed events share the same delivery path as REST-backed ones;
App-only events are reported as unsupported instead of being silently dropped.

## P5: operations

1. Done: `contrib/pollhook.service`, a `systemd --user` unit with the home
   read-only except `~/.local/state`. The token still comes from the gh login;
   nothing is stored in the unit or the config.
2. `gh webhook forward` children per repository, restarted with backoff, reported
   as degraded in `status`, with faster polling while down. Not started: the poll
   path is complete without it.
3. `pollhook cleanup` stays a no-op while pollhook creates no hooks. It becomes
   real if a forwarder mode lands.
4. `status` reports last poll, next poll, last event, quota and request counters.
5. Done: a ten-minute soak on `omnigame-studio/dev-server` measured 485 requests
   and 135 bodies, about 800 billable per hour; see [PROGRESS.md](PROGRESS.md).

Acceptance: a 24-hour soak on a quiet repository holds the request budget and
leaves no hooks behind.

## P6: packaging

Done. `tsc -p tsconfig.build.json` compiles `src` to `dist` and rewrites `.ts`
imports to `.js`. `bin` points at `dist/cli.js`, `files` ships only `dist`, and
`prepublishOnly` builds. Node 24 is required because the state store uses
`node:sqlite`. TypeScript is not published: Node does not strip types inside
`node_modules`.

## Decisions

1. Node 24 pinned with mise, TypeScript, no framework, `node:sqlite`. A single Go
   binary is the fallback if install friction matters more than shared tooling.
2. At-least-once delivery, dedupe on (event, action, object id, state fingerprint).
3. Exit codes `0` success, `1` failing conclusion, `8` timeout, `2` bad input or
   daemon unreachable. `8` mirrors `gh event listen`.
4. The Events API (`/users/{username}/events`, `/repos/{o}/{r}/events`) is not a
   source. It carries 16 activity types, has no CI, check, Pages or deployment
   events, retains 30 days, and its documented latency is 30s to 6h. Revisit it
   only as an optional accelerator for activity events.
5. `ghwait` from the original brief becomes `pollhook run`, `checks`, `pr`,
   `pages`; a `ghwait` shim can follow if scripts depend on the name.
6. Store 500 recent objects per repository; older ones are dropped, waits for them
   fail with `2` rather than hanging.
7. Token order is `POLLHOOK_TOKEN`, then the `gh` login, then `GH_TOKEN` and
   `GITHUB_TOKEN`. Ambient tokens lose to the login on purpose: they often belong
   to another account.
8. Default interval is 30 seconds. Measured cost is 15 requests per round on a
   two-PR repository, most of them `304`s, so the interval is set by API latency
   rather than by quota.
9. The first poll of each event primes silently and stores a marker, so a cold
   start does not replay history and a restart does not prime again.

## Open questions

1. Does `gh webhook forward` leave a webhook behind after it exits? Test it before
   deciding whether `cleanup` is mandatory.
2. Are the fields we guarantee identical to GitHub's payload for the same object?
   Capture real deliveries and keep them as fixtures.
3. What does a 50-branch, 20-open-PR repository cost per hour at a 15-second
   interval? Measure before promising the interval.
4. Is GraphQL avoidable in v1? Yes, if projects and discussions stay in P4.
5. GitHub Enterprise Server: configurable base URL, and the event catalog differs
   per version. Defer until someone asks.
6. Should `wait` also accept a JSON predicate (`--match conclusion=success`)? Yes,
   but only `k=v` on top-level fields in P1.

## Non-goals

1. Writing to GitHub: comments, reviews, labels, statuses, merges.
2. Backfilling history or replaying past events.
3. A web UI or a dashboard.
4. Installing a GitHub App in v1.
5. Multi-user operation. One user, one daemon, loopback only.
