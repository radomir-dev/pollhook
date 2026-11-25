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
create index if not exists deliveries_repo_event on deliveries (repo, event);
`;

export const KEEP_PER_GROUP = 500;
