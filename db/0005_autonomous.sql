-- Autonomous smart board: the teacher schedules a lesson for a room; the board runs it on its own.
alter table sessions
  add column if not exists room text,                                    -- which board runs it, e.g. "room-101"
  add column if not exists scheduled_at timestamptz,                     -- period start
  add column if not exists duration_min int not null default 50,         -- period length; the lesson never runs past it
  add column if not exists attendance int,                               -- headcount when the class started
  add column if not exists teacher_present boolean not null default false; -- teacher is on the video call: board pauses
create index if not exists sessions_room_scheduled on sessions (room, scheduled_at);

-- Warnings are spoken by the board; only alerts reach the teacher.
alter table alerts add column if not exists level text not null default 'alert' check (level in ('warning', 'alert'));
alter table alerts drop constraint if exists alerts_type_check;
alter table alerts add constraint alerts_type_check check (type in ('empty_room', 'phones', 'headcount_drop', 'no_students'));

drop trigger if exists sessions_notify on sessions;
create trigger sessions_notify
  after update of started_at, ended_at, current_segment, current_variant, recording_url, daily_room_url, teacher_present, attendance
  on sessions for each row execute function notify_board();
