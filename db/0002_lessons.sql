-- Lesson plans. A session is one run of a plan; /session/[id] plays it.
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  created_at timestamptz default now()
);

create table if not exists lesson_plans (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references sessions on delete cascade,
  model text not null,
  title text not null,
  summary text not null default '',
  objectives text[] not null default '{}',
  raw jsonb not null,                              -- full LLM output, for debugging
  created_at timestamptz default now()
);

create table if not exists segments (
  id uuid primary key default gen_random_uuid(),
  lesson_plan_id uuid not null references lesson_plans on delete cascade,
  idx int not null,
  kind text not null check (kind in ('intro', 'concept', 'recap')),
  title text not null,
  target_minutes numeric(4,1) not null,
  key_points text[] not null default '{}',
  checkpoint jsonb,                                -- {question, answer}; concept segments only
  script jsonb,                                    -- cached output of the segment script generator
  unique (lesson_plan_id, idx)
);
