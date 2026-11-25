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
