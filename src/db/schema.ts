export const SCHEMA = `
create table if not exists snapshots (
  repo text not null,
  event text not null,
  key text not null,
  state text not null,
  data text not null,
  updated_at text not null,
  primary key (repo, event, key)
);
create table if not exists cursors (
  kind text primary key,
  etag text,
  value text
);
create table if not exists deliveries (
  id text primary key,
  repo text not null,
  event text not null,
  action text,
  key text not null,
  fingerprint text not null,
  payload text not null,
  created_at text not null,
  delivered_at text,
  unique (repo, event, fingerprint)
);
drop table if exists workflow_durations;
create table if not exists run_durations (
  repo text not null,
  run_id text not null,
  workflow_id text not null,
  duration_ms integer not null,
  recorded_at text not null,
  unique (repo, run_id)
);
create index if not exists run_durations_lookup on run_durations (repo, workflow_id);
create index if not exists deliveries_repo_event on deliveries (repo, event);
`;

export const KEEP_PER_GROUP = 500;
