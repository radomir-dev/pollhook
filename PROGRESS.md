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
