-- Engagement monitoring, adaptive branching, recording.
alter table sessions
  add column if not exists started_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists recording_url text;

alter table segments add column if not exists simplified_script jsonb; -- cached "explain it more simply" variant

create table if not exists engagement_samples (          -- one row per ~5 s window from the room camera
  id bigint generated always as identity primary key,
  session_id uuid not null references sessions on delete cascade,
  at timestamptz not null default now(),
  persons int not null,                                  -- median people in frame over the window
  phones int not null,                                   -- max phones in frame over the window
  frames int not null
);
create index if not exists engagement_samples_session_at on engagement_samples (session_id, at);

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions on delete cascade,
  type text not null check (type in ('empty_room', 'phones', 'headcount_drop')),
  detail text not null,
  created_at timestamptz not null default now()
);
create index if not exists alerts_session_created on alerts (session_id, created_at);

create table if not exists checkpoint_results (          -- what the branching decided, and why
  id bigint generated always as identity primary key,
  session_id uuid not null references sessions on delete cascade,
  segment_id uuid not null references segments on delete cascade,
  attempt int not null,                                  -- 0 = first check, 1 = after the simplified replay
  answer text,
  grade text check (grade in ('correct', 'partial', 'wrong')),
  signals text[] not null default '{}',
  decision text not null check (decision in ('next', 'replay')),
  created_at timestamptz not null default now()
);
