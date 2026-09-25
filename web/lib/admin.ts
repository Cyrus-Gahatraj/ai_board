// Dashboard queries. Server only.
import { sql } from './db.ts'

// "Live" = started, not ended, and the classroom tab checked in within 2 minutes (heartbeat is 30 s).
const LIVE = sql`(s.started_at is not null and s.ended_at is null and s.last_seen_at > now() - interval '2 minutes')`

export type SessionRow = {
  id: string; title: string; topic: string; class_name: string | null
  created_at: Date; started_at: Date | null; ended_at: Date | null; last_seen_at: Date | null
  current_segment: number | null; current_variant: 'main' | 'simple' | null; segment_title: string | null; segment_count: number
  daily_room_url: string | null; recording_url: string | null; alert_count: number; live: boolean
  room: string | null; scheduled_at: Date | null; duration_min: number; attendance: number | null
  teacher_present: boolean; scripts_ready: number; peak_persons: number | null
}

const SESSION_COLS = sql`
  s.id, lp.title, s.topic, s.class_name, s.created_at, s.started_at, s.ended_at, s.last_seen_at,
  s.current_segment, s.current_variant, s.daily_room_url, s.recording_url,
  s.room, s.scheduled_at, s.duration_min, s.attendance, s.teacher_present,
  (select count(*) from segments g where g.lesson_plan_id = lp.id and g.script is not null)::int as scripts_ready,
  (select max(persons) from engagement_samples e where e.session_id = s.id and e.at >= s.started_at) as peak_persons,
  (select g.title from segments g where g.lesson_plan_id = lp.id and g.idx = s.current_segment) as segment_title,
  (select count(*) from segments g where g.lesson_plan_id = lp.id)::int as segment_count,
  (select count(*) from alerts a where a.session_id = s.id and a.level = 'alert')::int as alert_count,
  ${LIVE} as live`

export const listSessions = () => sql<SessionRow[]>`
  select ${SESSION_COLS} from sessions s join lesson_plans lp on lp.session_id = s.id
  order by ${LIVE} desc, (s.ended_at is null) desc, coalesce(s.scheduled_at, s.started_at, s.created_at) desc limit 30`

export const getSession = async (id: string) => (await sql<SessionRow[]>`
  select ${SESSION_COLS} from sessions s join lesson_plans lp on lp.session_id = s.id where s.id = ${id}`)[0]

export type AlertRow = {
  id: string; session_id: string; type: string; level: 'warning' | 'alert'; detail: string; created_at: Date
  title: string; class_name: string | null; room: string | null
}

// For one session: warnings and alerts. Across sessions (the dashboard panel): only what reached the teacher.
export const recentAlerts = (sessionId?: string, limit = 20) => sql<AlertRow[]>`
  select a.id, a.session_id, a.type, a.level, a.detail, a.created_at, lp.title, s.class_name, s.room
  from alerts a join sessions s on s.id = a.session_id join lesson_plans lp on lp.session_id = s.id
  ${sessionId ? sql`where a.session_id = ${sessionId}` : sql`where a.level = 'alert'`}
  order by a.created_at desc limit ${limit}`

export const sessionSegments = (sessionId: string) => sql<{
  id: string; idx: number; kind: string; title: string; minutes: number; checkpoint: { question: string; answer: string } | null
}[]>`
  select g.id, g.idx, g.kind, g.title, g.target_minutes::float as minutes, g.checkpoint
  from segments g join lesson_plans lp on lp.id = g.lesson_plan_id where lp.session_id = ${sessionId} order by g.idx`

export const checkpointResults = (sessionId: string) => sql<{
  segment_id: string; attempt: number; answer: string | null; grade: string | null; signals: string[]; decision: string; created_at: Date
}[]>`
  select segment_id, attempt, answer, grade, signals, decision, created_at
  from checkpoint_results where session_id = ${sessionId} order by created_at`

// The room over the last 10 minutes, plus the latest reading.
export const roomSummary = async (sessionId: string) => (await sql<{
  samples: number; avg_persons: number | null; phone_share: number | null; last_at: Date | null; last_persons: number | null; last_phones: number | null
}[]>`
  select count(*)::int as samples,
         round(avg(persons), 1)::float as avg_persons,
         round(avg((phones > 0)::int) * 100)::float as phone_share,
         max(at) as last_at,
         (array_agg(persons order by at desc))[1] as last_persons,
         (array_agg(phones order by at desc))[1] as last_phones
  from engagement_samples where session_id = ${sessionId} and at > now() - interval '10 minutes'`)[0]
