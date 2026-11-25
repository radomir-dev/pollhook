# Event catalog

The 76 events in GitHub's webhook catalog, their REST source, and how faithfully a
poller can reconstruct them.

Legend:

1. `object`: the REST object carries every field the payload needs; the delivery is
   assembled from it.
2. `derived`: the payload is inferred from a state diff. Actions and actors may be
   missing or wrong.
3. `partial`: the endpoint exposes only part of the state, or has no reliable
   cursor, or is too expensive to poll at a useful interval.
4. `none`: not observable with a user token.
5. `~` after an endpoint means it still needs checking against the REST docs before
   implementation.

Shorthand: `{o}/{r}` is owner/repo, `{org}` is the organisation, `{ref}` is a branch
name or commit SHA.

## CI, checks and deployments

| Event | REST source | Cursor | Fidelity | Phase |
| --- | --- | --- | --- | --- |
| `workflow_run` | `/repos/{o}/{r}/actions/runs` | `id` + `run_attempt` + `updated_at` | object | P1 |
| `workflow_job` | `/repos/{o}/{r}/actions/runs/{run_id}/jobs` | `id` + `status` + `completed_at` | object | P1 |
| `workflow_dispatch` | runs where `event=workflow_dispatch` | run `id` | derived | P2 done |
| `check_suite` | `/repos/{o}/{r}/commits/{ref}/check-suites` | `id` + `updated_at` | object | P1 |
| `check_run` | `/repos/{o}/{r}/commits/{ref}/check-runs` | `id` + `status` + `conclusion` | object | P1 |
| `status` | `/repos/{o}/{r}/commits/{ref}/statuses` | `id` + `updated_at` | object | P1 |
| `page_build` | `/repos/{o}/{r}/pages/builds` | `id` + `updated_at` | object | P1 |
| `deployment` | `/repos/{o}/{r}/deployments` | `id` + `updated_at` | object | P3 done |
| `deployment_status` | `/repos/{o}/{r}/deployments/{id}/statuses` | `id` + `updated_at` | object | P3 done |
| `deployment_review` | `/repos/{o}/{r}/actions/runs/{run_id}/pending_deployments` | environment `id` + approval state | partial | deferred |
| `deployment_protection_rule` | `/repos/{o}/{r}/environments/{env}/deployment_protection_rules` ~ | rule `id` + `updated_at` | partial | deferred |
| `merge_group` | runs where `event=merge_group` | run `id` + `head_sha` | partial | P2 done |

`check_suite` and `check_run` need the head SHAs you care about, so they are polled
per watched ref: branch tips plus open PR heads. `workflow_job` costs one request
per active run, so it is opt-in per repository.

## Pull requests, issues and comments

| Event | REST source | Cursor | Fidelity | Phase |
| --- | --- | --- | --- | --- |
| `pull_request` | `/repos/{o}/{r}/pulls?state=all&sort=updated` | `number` + `updated_at` | object | P1 |
| `pull_request_review` | `/repos/{o}/{r}/pulls/{number}/reviews` | `id` + `submitted_at` | object | P1 |
| `pull_request_review_comment` | `/repos/{o}/{r}/pulls/comments?sort=updated` | `id` + `updated_at` | object | P2 |
| `pull_request_review_thread` | GraphQL `reviewThreads` ~ | thread `id` + `isResolved` | partial | P4 |
| `issues` | `/repos/{o}/{r}/issues?state=all&sort=updated&since=` | `number` + `updated_at` | object | P2 done |
| `issue_comment` | `/repos/{o}/{r}/issues/comments?sort=updated` | `id` + `updated_at` | object | P2 done |
| `sub_issues` | `/repos/{o}/{r}/issues/{number}/sub_issues` | `id` + `updated_at` | object | P3 |
| `issue_dependencies` | `/repos/{o}/{r}/issues/{number}/dependencies/*` ~ | relationship `id` | partial | P4 |
| `issue_relates_to` | `/repos/{o}/{r}/issues/{number}/timeline` ~ | timeline event `id` | partial | P4 |
| `commit_comment` | `/repos/{o}/{r}/comments?sort=updated` | `id` + `updated_at` | object | P2 done |
| `discussion` | GraphQL `discussion` | `id` + `updatedAt` | object | P4 |
| `discussion_comment` | GraphQL `discussionComment` | `id` + `updatedAt` | object | P4 |
| `label` | `/repos/{o}/{r}/labels` | name + hash of color/description | derived | P2 done |
| `milestone` | `/repos/{o}/{r}/milestones?state=all` | `id` + `updated_at` | object | P2 done |

## Repository and git

| Event | REST source | Cursor | Fidelity | Phase |
| --- | --- | --- | --- | --- |
| `push` | `/repos/{o}/{r}/compare/{before}...{after}` | branch tip SHA | derived | P2 done |
| `create` | `/repos/{o}/{r}/branches`, `/tags` | name + SHA | derived | P2 done |
| `delete` | `/repos/{o}/{r}/branches`, `/tags` (absence) | name | derived | P2 done |
| `fork` | `/repos/{o}/{r}/forks?sort=newest` | `id` + `created_at` | object | P2 done |
| `star` | `/repos/{o}/{r}/stargazers` | `starred_at`, no sort | partial | P3 |
| `watch` | `/repos/{o}/{r}/subscribers` | `login`, full list per poll | partial | P3 |
| `public` | `/repos/{o}/{r}` → `visibility` | repo `id` + `visibility` | derived | P2 done |
| `repository` | `/repos/{o}/{r}` | `id` + `updated_at` + `full_name` | derived | P2 done |
| `release` | `/repos/{o}/{r}/releases` | `id` + `updated_at` | object | P2 done |
| `deploy_key` | `/repos/{o}/{r}/keys` | `id` + `created_at` | object | P3 done |
| `gollum` | wiki git remote `{repo}.wiki.git` | commit SHA | derived | P4 |
| `package` | `/user/packages`, `/orgs/{org}/packages` | `id` + `updated_at` | object | P4 |
| `registry_package` | same as `package` | `id` + `updated_at` | object | P4 |
| `repository_dispatch` | none, triggered by an API call | — | none | — |
| `repository_import` | `/repos/{o}/{r}/import` | `status` + `updated_at` | derived | P3 |
| `repository_ruleset` | `/repos/{o}/{r}/rulesets` | `id` + `updated_at` | object | P3 done |
| `branch_protection_rule` | `/repos/{o}/{r}/branches/{branch}/protection` | hash of the protection object | derived | deferred |
| `branch_protection_configuration` | same as `branch_protection_rule` | hash of the protection object | derived | P3 done |
| `security_and_analysis` | `/repos/{o}/{r}` → `security_and_analysis` | hash of the object | derived | P3 done |
| `meta` | `/meta` | field hash | derived | P4 |
| `security_advisory` | `/advisories` (global database) | `ghsa_id` + `updated_at` | partial | P4 |

## Security alerts

| Event | REST source | Cursor | Fidelity | Phase |
| --- | --- | --- | --- | --- |
| `dependabot_alert` | `/repos/{o}/{r}/dependabot/alerts` | `number` + `updated_at` | object | P3 done |
| `code_scanning_alert` | `/repos/{o}/{r}/code-scanning/alerts` | `number` + `updated_at` | object | P3 done |
| `secret_scanning_alert` | `/repos/{o}/{r}/secret-scanning/alerts` | `number` + `updated_at` | object | P3 done |
| `secret_scanning_alert_location` | locations nested in the alert | alert `number` + location set | object | deferred |
| `secret_scanning_scan` | `/repos/{o}/{r}/secret-scanning/scan-history` ~ | scan `id` + `updated_at` | partial | deferred |
| `repository_advisory` | `/repos/{o}/{r}/security-advisories` | `ghsa_id` + `updated_at` | object | P3 done |
| `repository_vulnerability_alert` | `/repos/{o}/{r}/vulnerability-alerts` (on/off) | repo `id` + enabled | partial | P3 done |

Deferred P3 events are not broken links: the REST endpoints return a different
shape than the webhook payload (`branch_protection_rule` is ruleset-shaped) or
need per-run reads (`deployment_review`), so shipping them would mean inventing
fields. `branch_protection_configuration` ships with a reduced payload: `branch`
and `changes.branch_protection.from/to`.

## Organisation, projects and apps

| Event | REST source | Cursor | Fidelity | Phase |
| --- | --- | --- | --- | --- |
| `member` | `/repos/{o}/{r}/collaborators` | `login` + permission hash | derived | P4 done |
| `membership` | `/orgs/{org}/memberships/{user}` ~ | `state` + `role` | derived | P4 |
| `team` | `/orgs/{org}/teams` | `id` + `updated_at` | object | P4 |
| `team_add` | `/repos/{o}/{r}/teams` | team `id` + repo | derived | P4 |
| `organization` | `/orgs/{org}` | `id` + `updated_at` | derived | P4 |
| `org_block` | `/orgs/{org}/blocks` | `id` + `login` | derived | P4 |
| `personal_access_token_request` | `/orgs/{org}/personal-access-token-requests` | `id` + `created_at` | object | P4 |
| `custom_property` | `/orgs/{org}/properties/schema` ~ | name + hash | derived | P4 |
| `custom_property_values` | `/orgs/{org}/properties/values` ~ | repo + hash | derived | P4 |
| `projects_v2` | GraphQL `projectV2` | `id` + `updatedAt` | object | P4 |
| `projects_v2_item` | GraphQL `projectV2Item` | `id` + `updatedAt` | object | P4 |
| `projects_v2_status_update` | GraphQL status updates ~ | `id` + `updatedAt` | partial | P4 |
| `project` | classic Projects, sunset | `id` + `updated_at` | partial | P4 |
| `project_card` | classic Projects, sunset | `id` + `updated_at` | partial | P4 |
| `project_column` | classic Projects, sunset | `id` + `updated_at` | partial | P4 |
| `installation` | `/app/installations` (App JWT) | `id` + `updated_at` | none | — |
| `installation_repositories` | App JWT, installation repositories | `id` | none | — |
| `installation_target` | App JWT, installation target | `id` | none | — |
| `github_app_authorization` | App-only | — | none | — |
| `marketplace_purchase` | Marketplace API ~ | `id` + `updated_at` | partial | — |
| `sponsorship` | GraphQL sponsorships ~ | `id` + `updatedAt` | partial | — |
| `ping` | synthesized at subscription | — | object | P0 |

## Action inference

`object` fidelity does not mean the action is free. For `pull_request`, the action
comes from comparing the previous and the current object:

| Observation | Action |
| --- | --- |
| first sight, `state=open`, `created_at=updated_at` | `opened` |
| `state=open` → `closed`, `merged=false` | `closed` |
| `state=open` → `closed`, `merged=true` | `closed` with `merged` |
| `state=closed` → `open` | `reopened` |
| `head.sha` changed | `synchronize` |
| `draft=false` → `draft=true` | `converted_to_draft` |
| `draft=true` → `draft=false` | `ready_for_review` |
| `labels` set changed | `labeled` / `unlabeled` per label |

Everything that happens between two polls and leaves no trace in the final object
is lost. A close and a reopen inside one interval look like no change at all.

## Caveats that apply to every event

1. `sender` is the authenticated user, or `ghost` when the API cannot attribute the
   action. GitHub has the same problem for some events, but it often knows the
   actor where polling does not.
2. `updated_at` has one-second granularity, so a poll re-reads a two-interval
   overlap window and dedupes by state fingerprint instead of trusting the cursor.
3. GitHub may coalesce rapid intermediate states itself; polling can only add to
   that, never remove it.
4. Deletions are observed as absence. An object deleted and recreated between polls
   is indistinguishable from one that never changed.
5. Payloads from list endpoints are the full resource, not the trimmed webhook
   shape. Extra fields are passed through; consumers that reject unknown fields
   will notice.
