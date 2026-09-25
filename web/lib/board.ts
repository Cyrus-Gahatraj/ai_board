import { sql } from './db.ts'

export const isRoom = (s: string) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(s)

// The session this room's board should run now or next: not ended, and its period hasn't finished.
export async function nextSessionForRoom(room: string) {
  const [s] = await sql<{ id: string; scheduled_at: Date; duration_min: number; title: string; class_name: string | null }[]>`
    select s.id, s.scheduled_at, s.duration_min, lp.title, s.class_name
    from sessions s join lesson_plans lp on lp.session_id = s.id
    where s.room = ${room} and s.ended_at is null and s.scheduled_at is not null
      and s.scheduled_at + make_interval(mins => s.duration_min) > now()
    order by s.scheduled_at limit 1`
  return s ?? null
}
