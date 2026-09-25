-- Admin dashboard: live progress on sessions, Daily room, and NOTIFY-based live updates.
alter table sessions
  add column if not exists class_name text,                                   -- room model: the class, not one student
  add column if not exists current_segment int,
  add column if not exists current_variant text check (current_variant in ('main', 'simple')),
  add column if not exists last_seen_at timestamptz,                          -- classroom heartbeat; stale = tab closed
  add column if not exists daily_room_url text;

-- Live updates for /admin: every alert, and meaningful session changes, go out on channel 'board'.
-- (The dashboard listens with LISTEN and streams events to the browser.)
create or replace function notify_board() returns trigger language plpgsql as $$
begin
  perform pg_notify('board', json_build_object('table', TG_TABLE_NAME, 'row', to_jsonb(NEW))::text);
  return NEW;
end $$;

drop trigger if exists alerts_notify on alerts;
create trigger alerts_notify after insert on alerts for each row execute function notify_board();

-- Not on last_seen_at: heartbeats every few seconds shouldn't refresh every dashboard.
drop trigger if exists sessions_notify on sessions;
create trigger sessions_notify
  after update of started_at, ended_at, current_segment, current_variant, recording_url, daily_room_url on sessions
  for each row execute function notify_board();
