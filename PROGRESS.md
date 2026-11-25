# Progress

## 2026-11-25: P0 and P1

Implemented in one pass:

1. Daemon polls workflow runs, check suites, check runs, pull requests, reviews,
   commit statuses and Pages builds.
2. SQLite state for snapshots, ETags, deliveries and fingerprints. A restart does
   not redeliver an observed state.
3. Conditional requests with ETags, a quota governor at 100 remaining, and two
   retries on 5xx.
4. Unix-socket control API: `status`, `events`, `deliveries`, `emit` and `wait`.
5. Waits read stored state before blocking: `run`, `checks`, `pr --until`, `pages`
   and `wait --event`, with exit codes `0` success, `1` failing conclusion, `8`
   timeout, `2` bad input or unreachable daemon.
6. Optional loopback POST deliveries with GitHub's headers and HMAC signatures.
7. `pollhook.example.json` and `.mise.toml` pinning Node 24.22.3.

Verification: `tsc --noEmit` clean, `npm test` 23 of 23 passing on Node 24.22.3.

Fixes made during the first pass:

1. `net.Server` has no `closeAllConnections` at runtime, so the daemon tracks its
   sockets and destroys them on shutdown.
2. Adapters receive a repository-bound emit; the six-argument sink belongs to the
   daemon.
3. Snapshot listing breaks ties on rowid, because two writes can share a
   millisecond.

Next:

1. Measure idle cost against `omnigame-studio/dev-server` and derive the default
   interval from the measurement.
2. P2: `push` from `/compare`, then `create` and `delete` from branch and tag
   diffs.
3. Verify whether `gh webhook forward` leaves a hook behind, then decide whether
   `cleanup` is needed.

## 2026-11-25: idle cost

Measured against `omnigame-studio/dev-server` at a 30 second interval, after
adding request counters to the client and the status output:

1. A round costs 15 requests: 1 workflow runs, 1 pull requests, 2 reviews for the
   two open PRs, 1 Pages builds, 3 refs across check suites, check runs and commit
   statuses, and 1 default-branch ref.
2. The first 100 seconds made 49 requests, 23 of them `304`; the rest were the cold
   first fetch of each endpoint. Warm rounds revalidate almost everything.
3. One API call takes about 2.3 seconds from this host, so a round lasts 30 to 40
   seconds. A shorter interval would queue adapters, not speed anything up.
4. At 30 seconds the traffic is about 1,800 requests per hour, with only changed
   responses billed; that stays well under the 5,000 hourly limit.

Found while measuring:

1. `GITHUB_TOKEN` in this shell belongs to another account and returned 404 for the
   repository, but `resolveToken` preferred it over `gh auth token`, so the daemon
   polled nothing. `page_build` swallowed its own 404 and cleared the error, which
   hid the failure. Token order is now `POLLHOOK_TOKEN`, gh login, environment.
2. A round now keeps its first error even when a later adapter succeeds.
3. `status` reports `http: { requests, notModified }`, so cost can be attributed
   without reading the shared quota.

Verification: `tsc --noEmit` clean, 30 of 30 tests passing.

Next:

1. Prime silently. The first sync emitted 130 deliveries for runs and PRs that
   already existed. Record a snapshot on first sight without emitting, then emit
   only real transitions.
2. P2: `push` from `/compare`, then `create` and `delete` from branch and tag
   diffs.
3. Verify whether `gh webhook forward` leaves a hook behind.
4. Package for npm/npx: P6 in AGENDA.md.

## 2026-11-25: silent priming

The first poll of each event now records snapshots and suppresses deliveries. The
marker lives in the cursors table as `primed:<repo>:<event>`, so a restart neither
replays history nor primes again: objects created while the daemon was down still
deliver on the next poll. The 130-delivery cold-start flood from the idle
measurement is gone.

Verification: `tsc --noEmit` clean, 32 of 32 tests passing.

Next:

1. P2: `push` from `/compare`, then `create` and `delete` from branch and tag
   diffs.
2. Verify whether `gh webhook forward` leaves a hook behind.
3. Package for npm/npx: P6 in AGENDA.md.

## 2026-11-25: push (P2)

`push` polls `/branches` and reconstructs a delivery from `/compare` when a tip
moves: `before`, `after`, `commits`, `head_commit` and `forced` when the compare
reports `diverged`. A branch first seen after priming is reported as `created`
with a zero `before` and up to 20 commits. A 404 from compare, which happens for
orphaned or garbage-collected history, records the new tip without a delivery
instead of retrying forever. Branches are capped at the first 100.

Known gap: `pusher` is the authenticated user, not the person who pushed; the REST
API does not record it.

Verification: `tsc --noEmit` clean, 37 of 37 tests passing.

Next:

1. P2 continued: `create` and `delete` from branch and tag diffs.
2. Verify whether `gh webhook forward` leaves a hook behind.
3. Package for npm/npx: P6 in AGENDA.md.

## 2026-11-25: create and delete (P2)

`create` and `delete` share a refs snapshot namespace keyed by `branch:<name>` and
`tag:<name>`. `create` emits when a ref appears, or reappears after deletion; a
moved tag or a force-pushed branch updates the snapshot without a create. `delete`
emits once when a stored ref disappears, then marks it deleted. Both read the first
100 branches and tags and fall back to the stored refs on a `304`, so an unchanged
list costs no body.

Verification: `tsc --noEmit` clean, 42 of 42 tests passing.

Next:

1. P2 activity events: `issues`, `issue_comment`, `release`, `label`, `milestone`.
2. Verify whether `gh webhook forward` leaves a hook behind.
3. Package for npm/npx: P6 in AGENDA.md.

## 2026-11-25: issues and comments (P2)

`issues` polls `/issues?state=all&sort=updated`, drops entries that carry a
`pull_request` key, and derives opened, closed, reopened, labeled, unlabeled and
edited from state, labels and a hash of title and body. `updated_at` is excluded on
purpose: adding a comment bumps it and would otherwise look like an issue edit.

`issue_comment` polls `/issues/comments?sort=updated`, emits `created` on first
sight and `edited` when the body hash changes, and attaches the issue from the
issues snapshot, falling back to the pull request snapshot and then `{number}`.
Deleted comments are not detected: the feed is capped at 100 and absence is not
evidence.

Verification: `tsc --noEmit` clean, 47 of 47 tests passing.

Next:

1. P2 remainder: `release`, `label`, `milestone`.
2. Verify whether `gh webhook forward` leaves a hook behind.
3. Package for npm/npx: P6 in AGENDA.md.

## 2026-11-25: releases, labels and milestones (P2)

Three diff adapters:

1. `release` publishes on first sight unless the release is a draft, and derives
   draft to published, prerelease flips and edits. Deletion is not detected: the
   list is capped at 30 and absence is not evidence.
2. `label` hashes name, color, description and default; edits and creations come
   from that hash, deletion from absence, marked so a re-created label emits
   `created` again.
3. `milestone` derives created, closed, reopened and edited from the same pattern,
   with deletion detected by absence.

Verification: `tsc --noEmit` clean, 50 of 50 tests passing.

Next:

1. P2 remainder: `public`, `repository`, `fork`, `watch`, `star`,
   `commit_comment`, `workflow_dispatch`, `merge_group`.
2. Verify whether `gh webhook forward` leaves a hook behind.
3. Package for npm/npx: P6 in AGENDA.md.

## 2026-11-25: repository, forks and commit comments (P2)

1. `repository` hashes full name, visibility, description, default branch,
   archived, disabled, topics and homepage, then derives renamed,
   archived/unarchived, publicized/privatized and edited.
2. `public` is a separate adapter with its own ETag key so the private to public
   transition is the only thing it emits. Sharing a key with `repository` would
   make the second adapter see a `304` and drop its event.
3. `fork` keys on the fork id and its creation time, so updates to an existing
   fork do not re-emit.
4. `commit_comment` emits created and edited from the body hash and `updated_at`;
   deletions are not detected because the feed is capped at 100.

Verification: `tsc --noEmit` clean, 54 of 54 tests passing.

Next:

1. P2 remainder: `watch` and `star` (both partial), `workflow_dispatch`,
   `merge_group`.
2. Verify whether `gh webhook forward` leaves a hook behind.
3. Package for npm/npx: P6 in AGENDA.md.

## 2026-11-25: dispatches and merge groups (P2)

`workflow_dispatch` and `merge_group` both read `/actions/runs?event=...`, filter
on `event`, and emit on the first sight of a run id, so a status change or a
re-run does not emit again.

Payloads are reduced on purpose: `workflow_dispatch` carries `workflow_run` rather
than GitHub's dispatch envelope, and `merge_group` carries `head_sha` and
`head_ref` with null `base_sha` and `base_ref` because merge queue state is
GraphQL-only. Both remain `derived` in docs/events.md.

`watch` and `star` stay deferred: subscribers has no cursor and stargazers has no
sort, so both need whole-list scans and produce false positives on large
repositories. They remain `partial` in docs/events.md.

Verification: `tsc --noEmit` clean, 57 of 57 tests passing.

Next:

1. P3 security alerts: `dependabot_alert`, `code_scanning_alert`,
   `secret_scanning_alert`.
2. Verify whether `gh webhook forward` leaves a hook behind.
3. Package for npm/npx: P6 in AGENDA.md.

## 2026-11-25: security alerts (P3)

Three alert adapters at a five-minute floor:

1. `dependabot_alert` reads one request with the comma-separated state list
   `open,dismissed,fixed,auto_dismissed`, verified against the API.
2. `code_scanning_alert` reads `open`, `dismissed` and `fixed` as separate
   requests, and `secret_scanning_alert` reads `open` and `resolved` the same way.
   The docs do not promise a comma list for those two, and an extra request every
   five minutes is cheaper than a wrong assumption.
3. Actions: created, reopened, dismissed or closed, fixed, resolved, validated and
   edited, derived from state and validation status transitions.

Required scopes are not checked at startup; a disabled feature or missing scope
surfaces in `status` as the endpoint error. On `dev-server`, code scanning answers
403 because Code Security is off and secret scanning answers 404 because it is
disabled, which is the expected shape of that failure.

Verification: `tsc --noEmit` clean, 60 of 60 tests passing.

Next:

1. P3 remainder: `repository_advisory`, `repository_vulnerability_alert`,
   `repository_ruleset`, `branch_protection_rule`,
   `branch_protection_configuration`, `deploy_key`, `secret_scanning_alert_location`,
   `secret_scanning_scan`, `deployment`, `deployment_status`.
2. Verify whether `gh webhook forward` leaves a hook behind.
3. Package for npm/npx: P6 in AGENDA.md.

## 2026-11-25: deployments, deploy keys, rulesets (P3)

1. `deployment` emits `created` on the first sight of a deployment id. A
   deployment is immutable, so `created_at` is the whole state.
2. `deployment_status` reads the ten newest deployments and their statuses, which
   is 11 requests per round at a five-minute floor, and emits `created` per status
   id.
3. `deploy_key` emits `created` on first sight and `deleted` on absence. Key
   material is immutable, so a title change only updates the snapshot.
4. `repository_ruleset` hashes the ruleset object, maps a changed hash to
   `edited`, and absence to `deleted`.

Verification: `tsc --noEmit` clean, 64 of 64 tests passing.

Next:

1. P3 remainder: `repository_advisory`, `repository_vulnerability_alert`,
   `branch_protection_rule`, `branch_protection_configuration`,
   `secret_scanning_alert_location`, `secret_scanning_scan`, `deployment_review`,
   `deployment_protection_rule`, `security_and_analysis`.
2. Verify whether `gh webhook forward` leaves a hook behind.
3. Package for npm/npx: P6 in AGENDA.md.

## 2026-11-25: advisories and repository security (P3)

1. Added `GithubClient.probe` for endpoints that answer 204 or 404 instead of
   JSON. `repository_vulnerability_alert` uses it and reports enable or disable
   from the flip.
2. `repository_advisory` maps first sight to `published`, state `closed` to
   `closed`, and everything else to `updated`.
3. `security_and_analysis` diffs the repository field and carries `from` and `to`
   under `changes`.

Remaining P3 work is deliberately behind operations and packaging: branch
protection needs one request per branch, secret scanning locations and scans are
nested or GraphQL-bound, and deployment review needs pending-deployment reads.

Verification: `tsc --noEmit` clean, 67 of 67 tests passing.

Next:

1. P6: package for npm/npx. The bin is TypeScript, so decide between requiring
   Node 24 and compiling at publish time.
2. P5: systemd user unit, `pollhook cleanup`, and a soak test.
3. P3 leftovers: branch protection, secret scanning locations and scans,
   deployment review, deployment protection rules.

## 2026-11-25: npm packaging (P6)

Compiled output is what ships. `tsconfig.build.json` emits `src` to `dist` with
`rewriteRelativeImportExtensions`, so every `.ts` import becomes `.js` in the
output and the `#!` line survives. `bin` points at `dist/cli.js`, `files` ships
only `dist`, `prepublishOnly` builds, and `engines.node` is `>=24` because the
state store needs `node:sqlite`. Shipping TypeScript instead would fail inside
`node_modules`, where Node does not strip types.

Verified:

1. `npm run build` writes `dist/cli.js` with the shebang and `.js` imports.
2. `node dist/cli.js --help` exits 0; `status` without a config exits 2 with a
   readable error.
3. `npm pack`, install the tarball into a temporary prefix, then
   `node_modules/.bin/pollhook --help` exits 0.

`tsc --noEmit` clean, 67 of 67 tests unchanged.

Next:

1. P5: systemd user unit, `pollhook cleanup`, and a soak test.
2. P3 leftovers: branch protection, secret scanning locations and scans,
   deployment review, deployment protection rules.

## 2026-11-25: systemd unit (P5)

Added `contrib/pollhook.service`. The unit runs `pollhook daemon`, restarts on
failure, puts the mise shims and `~/.local/bin` on `PATH`, and hardens the service
with `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=full` and
`ProtectHome=read-only` except `~/.local/state`. The token is not stored: the
daemon reads the gh login.

`systemd-analyze verify contrib/pollhook.service` parses the unit; its only message
is that `~/.local/bin/pollhook` does not exist yet, which `npm link` fixes.

`pollhook cleanup` remains a no-op on purpose: pollhook creates no GitHub webhooks,
so there is nothing to remove until a forwarder mode exists.

Verification: `tsc --noEmit` clean, 67 of 67 tests passing.

Next:

1. P5 soak: run the daemon for ten minutes against `omnigame-studio/dev-server`
   and record `http.requests`, `http.notModified` and the quota delta.
2. P3 leftovers: branch protection, secret scanning locations and scans,
   deployment review, deployment protection rules.

## 2026-11-25: ten-minute soak (P5)

Ran the daemon for ten minutes against `omnigame-studio/dev-server` with the
example config, sampling `status` every minute:

1. 485 requests, 350 of them `304`; 135 bodies fetched.
2. The quota fell by 176, so roughly 41 responses belonged to other clients on the
   same token.
3. 235 deliveries and no polling errors; the last poll landed one second before
   shutdown.
4. Extrapolated: about 2,900 requests per hour and 800 billable, well under the
   5,000 limit. The repository is active, so this is a load figure, not an idle
   one.

The 30-second adapters dominate the request count; the five-minute alert,
deployment and ruleset adapters add little.

Verification: `tsc --noEmit` clean, 67 of 67 tests passing.

Next:

1. Apply the new size rules: `src/cli.ts` has 290 lines, `src/daemon.ts` 234 and
   `src/db.ts` 224. Split them and bring functions under 30 lines.
2. P3 leftovers: branch protection, secret scanning locations and scans,
   deployment review, deployment protection rules.

## 2026-11-25: size-rule refactor

Every file is under 200 lines and every function under 30, per the updated
AGENTS.md:

1. `cli.ts` became four modules: `cli/args.ts` for flag parsing, `cli/rpc.ts` for
   the socket client, `cli/commands.ts` with one handler per subcommand, and
   `cli/usage.ts` for the help text. The entry file is 38 lines.
2. `daemon.ts` keeps composition only; `daemon/handlers.ts` owns the socket
   protocol, `daemon/waiter.ts` owns one wait with start, finish and cancel, and
   `daemon/context.ts` holds the shared type.
3. `db.ts` is a one-line re-export. `db/snapshots.ts`, `db/deliveries.ts` and
   `db/cursors.ts` own their tables; `db/store.ts` composes them and handles
   pruning.
4. `Poller.pollOnce` split into `pollRepo` and `pollAdapter`.

Largest file is 174 lines and no function exceeds 30. The refactor is
behaviour-preserving, so the suite is unchanged.

Verification: `tsc --noEmit` clean, 67 of 67 tests passing, function-length scan
reports no violations.

Next:

1. P3 leftovers: branch protection, secret scanning locations and scans,
   deployment review, deployment protection rules.
2. P4: organisation, projects and app events.

## 2026-11-25: branch protection configuration (P3)

`branch_protection_configuration` reads the first 20 branches and each branch's
protection, skipping 404 for unprotected branches and 403 when the token cannot
administer them. It hashes the protection object and emits `edited` with the
branch and `changes.branch_protection.from/to`. The payload is reduced: GitHub's
own event carries `changes` keyed by the field that changed, not the whole object.

The rest of P3 stays deferred, and docs/events.md now says so: the
`branch_protection_rule` payload is ruleset-shaped, secret scanning locations and
scans need per-alert reads, and deployment review needs per-run reads. Shipping
them would mean inventing fields.

Verification: `tsc --noEmit` clean, 69 of 69 tests passing.

Next:

1. P4: organisation, projects and app events.
2. P5: report the next poll time in `status`.

## 2026-11-25: repository collaborators (P4)

`member` reads `/repos/{o}/{r}/collaborators`, hashes each user's permission map,
emits `added` on first sight, `edited` when permissions change, and `removed` when
a login disappears. The list is capped at 100; a repository with more
collaborators would produce false removals, so the cap is documented instead of
being silently trusted.

The org-level `membership`, `team` and `organization` events need an org target in
the config, which today holds repositories only. That is the next structural step
before those adapters.

Verification: `tsc --noEmit` clean, 71 of 71 tests passing.

Next:

1. P4: add an optional `orgs` config section, then `membership`, `team` and
   `organization`.
2. P5: report the next poll time in `status`.

## 2026-11-25: org targets and teams (P4)

An optional `orgs` array joined `repos` in the config. `loadConfig` accepts
repo-only, org-only or both, defaults org events to the org-scoped adapters, and
rejects a repo event under `orgs` with the list of allowed names.

The poller polls two target kinds. `Adapter` gained an optional `scope` (`repo` or
`org`), `adaptersFor(events, scope)` filters, statuses carry `kind`, and
`AdapterContext.org` is present only for org targets.

`team` is the first org adapter: it hashes the team list, derives created, edited
and deleted, and carries `organization: {login}` rather than the full org object,
which would cost another request.

Verification: `tsc --noEmit` clean, 76 of 76 tests passing.

Next:

1. P4 remainder: `membership`, `organization`, projects and packages.
2. P5: report the next poll time in `status`.

## 2026-11-25: team membership (P4)

`membership` reads the org's teams, then the members of the first ten teams. Each
pair is keyed `slug:login`; an addition emits `added` and a pair that disappears
emits `removed`. A `304` on a team's member list reuses the stored rows for that
team, so revalidation is never mistaken for a removal, and rows for teams outside
the ten-team window are ignored rather than treated as deleted.

The payload is `{action, scope: "team", member, team, organization, sender}`; the
full organization object is not fetched, only `{login}`.

Verification: `tsc --noEmit` clean, 79 of 79 tests passing.

Next:

1. P4 remainder: `organization`, projects and packages.
2. P5: report the next poll time in `status`.

## 2026-11-25: next poll in status (P5)

`status` reports `nextPollAt` for each target: the earliest due time among that
target's enabled adapters, taken from the poller's schedule. The CLI prints
`next_poll=` next to `last_poll=`.

P4 stays where it is. The remaining organisation, project and package events need
payload shapes the REST API does not expose: project board items are GraphQL-only
and packages need one request per package type. They are recorded as deferred
rather than approximated.

Verification: `tsc --noEmit` clean, 80 of 80 tests passing.

Next:

1. Re-verify packaging after the module split: build, pack, install the tarball
   and run the bin.
2. Revisit P4 deferred events only if a consumer needs them.

## 2026-11-25: packaging re-check

After the module split the published shape still works:

1. `npm run build` emits `dist/` with `.js` imports and the shebang intact.
2. `node dist/cli.js --help` exits 0; `status` without a config exits 2.
3. `npm pack`, install the tarball into a temporary prefix, `pollhook --help`
   exits 0 and `pollhook status` exits 2.

No changes were needed; `dist/` stays gitignored.

Verification: `tsc --noEmit` clean, 80 of 80 tests passing.

Next:

1. P5: repeat the ten-minute soak including an org target and the newer adapters,
   and confirm the request budget.
2. P4: revisit the deferred events only if a consumer needs them.

## 2026-11-25: soak with an org target

Ten minutes with the example config: 33 repository events plus `team` and
`membership` on `radomir-dev`, sampled every minute.

1. 470 requests, 426 of them `304`, so 44 bodies were fetched.
2. 60 deliveries. The quota fell 131, so roughly 87 responses belonged to other
   clients on the same token.
3. Extrapolated: about 3,100 requests per hour and 300 billable, under the limit.
4. The only error was the expected 403 from code scanning, which is disabled on
   that repository. It stays visible in `status` rather than being swallowed, per
   the P3 decision that missing capabilities should fail loudly.
5. Both targets reported `nextPollAt`.

Verification: `tsc --noEmit` clean, 80 of 80 tests passing.

Next:

1. P5: report a permanently unavailable feature once, as degraded, instead of on
   every round.
2. P4: revisit the deferred events only if a consumer needs them.

## 2026-11-25: permanent failures as degraded

The poller separates 403 and 404 from transient failures. A permanent failure
marks that adapter degraded for the target, keeps the first reason, and leaves
`lastError` alone; a transient failure still lands in `lastError`. A successful
poll of the adapter clears the degradation.

`status` carries `degraded: [{event, reason}]` and the CLI adds `degraded=...` to
its line. Skipped adapters, which are not due yet, no longer count as successes;
that bug cleared the degradation on the very next tick.

Verification: `tsc --noEmit` clean, 82 of 82 tests passing.

Next:

1. P5: back off a degraded adapter for an hour instead of polling it every floor.
2. P4: revisit the deferred events only if a consumer needs them.

## 2026-11-25: degraded adapters back off

A permanent failure (403 or 404) now pushes that adapter's next poll an hour out,
so a disabled feature stops costing a request every floor. Transient errors keep
the normal cadence, `nextPollAt` shows the backoff, and a successful retry clears
the degraded entry.

Verification: `tsc --noEmit` clean, 82 of 82 tests passing.

Next:

1. P4: revisit the deferred events only if a consumer needs them.
2. P5: a short README note on reading `status`, including `degraded`.

## 2026-11-25: reading status

The README now explains the `status` output: last and next poll, last event,
transient `error`, and `degraded` adapters with their retry behaviour.

Verification: `tsc --noEmit` clean, 82 of 82 tests passing (docs only).

Next:

1. P4: revisit the deferred events only if a consumer needs them.
2. Review the README end to end once the event work settles.

## 2026-11-25: README review

Read the README end to end and fixed drift: it now says the daemon polls
repositories and organisations, names `membership` alongside `team`, calls the
POST target optional and loopback, lists 82 tests, and includes the systemd unit
in the layout.

Verification: `tsc --noEmit` clean, 82 of 82 tests passing (docs only).

Next:

1. P4: revisit the deferred events only if a consumer needs them.
2. Ask the user before publishing 0.1.0 to npm.

## 2026-11-25: catalog audit

Compared the adapter registry with `docs/events.md`: 35 events are implemented and
all are now marked done. The seven P1 rows still said `P1` and were corrected, and
no row claims an event that is not implemented.

The unattended backlog is down to decisions rather than code: the deferred P4
events, only if a consumer needs them, and publishing 0.1.0, which needs approval.

Verification: `tsc --noEmit` clean, 82 of 82 tests passing (docs only).

Next:

1. Ask about pausing the automation: there is no unattended code work left.

## 2026-11-25: CLI argument tests

Added coverage for the CLI argument helpers: duration units, positional
extraction that respects value-taking flags, repeated `--match`, and required
values. The daemon and wait paths were tested; the surface agents actually type
was not.

Verification: `tsc --noEmit` clean, 87 of 87 tests passing.

Next:

1. Ask about pausing the automation; no unattended code work is queued.
2. A CLI end-to-end test once there is a reason to keep the loop running.

## 2026-11-25: CLI end-to-end test

The CLI is now exercised against an in-process daemon backed by the fake GitHub:
`status --json`, `run` on a finished run (exit 0), `run` with a one-second timeout
(exit 8), and `status` with no daemon (exit 2). It spawns `src/cli.ts` rather than
importing it, so argument parsing, config loading, the socket client and the exit
codes are all covered.

The first attempt used `spawnSync` and deadlocked: it blocked the event loop the
in-process daemon runs on, so the daemon could not answer. The test uses async
spawn.

Verification: `tsc --noEmit` clean, 89 of 89 tests passing.

Next:

1. Ask about pausing the automation; no unattended code work is queued.

## 2026-11-25: fixed `emit` never subscribing

`pollhook emit` connected to the daemon and then sent nothing, so the daemon
never registered it as a listener and the stream stayed empty while deliveries
piled up in the database. `stream()` in `src/cli/rpc.ts` ignored its message
argument. It now writes the request before waiting for deliveries.

`test/emit.test.ts` runs the real CLI against a stub socket and asserts the
subscription request arrives and only deliveries reach stdout. The raw socket
path was already covered; the CLI side was not.

Verification: `tsc --noEmit` clean, 90 of 90 tests passing.

Next:

1. Ask about pausing the automation; no unattended code work is queued.

## 2026-11-25: emit --brief

`emit --brief` prints one line per delivery: local time, repo, event, action and
key. The full payload still streams by default, so `jq` remains usable.

Verification: `tsc --noEmit` clean, 92 of 92 tests passing.

Next:

1. Ask about pausing the automation; no unattended code work is queued.

## 2026-11-25: pollhook poke

`pollhook poke [--repo OWNER/NAME]` makes the daemon poll now instead of waiting out
the interval. It clears the due times (degraded adapters keep their back-off) and
reschedules the loop unless a round is already running. Unknown repositories are
rejected.

Verification: `tsc --noEmit` clean, 94 of 94 tests passing.

Next:

1. Per-event intervals, then adaptive polling per target.

## 2026-11-25: workflow durations, richer brief, slow poll while early

1. Every workflow's last twenty durations are stored from runs already fetched,
   so the typical duration costs no requests. A run's duration is
   `updated_at - run_started_at`, recorded once per run id, so the first poll
   backfills the whole list and later polls insert nothing.
2. `delayFor` polls `workflow_run` every 30 seconds instead of the configured
   interval while every running workflow is under half its typical duration, and
   keeps the fast interval otherwise so a new run is noticed quickly. Degraded
   adapters still back off for an hour.
3. `emit --brief` adds the run or check name, the conclusion on completion, and
   the elapsed time while a run is in progress. No payload gains estimated
   fields; the estimate only affects scheduling and the printed line.
4. `poller.ts` was split again to stay under 200 lines: `poller/status.ts`,
   `poller/refs.ts` and `poller/schedule.ts`.

Verification: `tsc --noEmit` clean, 107 of 107 tests passing, every `src` file at
or under 200 lines.

Next:

1. Per-event intervals, the remaining quota lever.
