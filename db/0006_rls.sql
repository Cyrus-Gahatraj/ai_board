-- Supabase exposes public tables over its REST API. RLS with no policies blocks that;
-- the app connects as postgres (table owner, bypasses RLS) so it is unaffected.
alter table documents enable row level security;
alter table chunks enable row level security;
alter table lesson_plans enable row level security;
alter table segments enable row level security;
alter table sessions enable row level security;
alter table engagement_samples enable row level security;
alter table checkpoint_results enable row level security;
alter table alerts enable row level security;
