import { isUuid, sql } from '@/lib/db.ts'
import { DETAIL, ladder, persistent, RULES, signals, WARNING_TEXT, type Signal } from '@/lib/engagement.ts'
import { roomSamples } from '@/lib/room.ts'

const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 500 ? (v as number) : null)
const NO_STUDENTS_AFTER_S = 5 * 60 // after the bell, an empty room this long means the class never showed up

// The board posts one summary per ~5 s of room-camera frames. Stores it, then walks the discipline ladder
// (warn the room aloud → alert the teacher) for signals that persisted past RULES.persistS.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'bad session id' }, { status: 400 })
  const b = await req.json().catch(() => ({}))
  const persons = count(b.persons), phones = count(b.phones), frames = count(b.frames)
  if (persons === null || phones === null || frames === null)
    return Response.json({ error: 'persons, phones, frames must be integers 0-500' }, { status: 422 })

  const [session] = await sql`update sessions set last_seen_at = now() where id = ${id} returning started_at, ended_at, scheduled_at`
  if (!session) return Response.json({ error: 'session not found' }, { status: 404 })
  await sql`insert into engagement_samples (session_id, persons, phones, frames) values (${id}, ${persons}, ${phones}, ${frames})`

  const { samples, baseline } = await roomSamples(id, RULES.recentS)
  const now = Date.now()
  const active = persistent(samples, baseline, now)
  const recent = samples.filter(s => s.at >= now - RULES.persistS * 1000)
  const warn: { type: Signal; text: string }[] = []
  const alerts: unknown[] = []

  const raise = async (type: string, level: 'warning' | 'alert', detail: string) => {
    const [a] = await sql`insert into alerts (session_id, type, level, detail) values (${id}, ${type}, ${level}, ${detail}) returning type, level, detail, created_at`
    return a
  }
  const last = async (type: string) => {
    const [r] = await sql`
      select extract(epoch from max(created_at) filter (where level = 'warning')) * 1000 as warn_at,
             extract(epoch from max(created_at) filter (where level = 'alert')) * 1000 as alert_at
      from alerts where session_id = ${id} and type = ${type}`
    return { warnAt: r.warn_at === null ? null : Number(r.warn_at), alertAt: r.alert_at === null ? null : Number(r.alert_at) }
  }

  if (!session.started_at) {
    // Before class: the board is waiting for students. Only "nobody came" is worth telling the teacher.
    const late = session.scheduled_at && now - +session.scheduled_at > NO_STUDENTS_AFTER_S * 1000
    if (late && active.includes('empty_room')) {
      const { alertAt } = await last('no_students')
      if (alertAt === null || now - alertAt > 10 * 60_000)
        alerts.push(await raise('no_students', 'alert', `No students in the room ${Math.round((now - +session.scheduled_at) / 60_000)} min after the class was due to start`))
    }
  } else if (!session.ended_at) {
    for (const type of active) {
      const { warnAt, alertAt } = await last(type)
      const step = ladder(type, warnAt, alertAt, now)
      const detail = `${DETAIL[type]} for ${RULES.persistS}s+ (now: ${persons} people, ${phones} phones; usual: ${Math.round(baseline)} people)`
      if (step === 'warn') { await raise(type, 'warning', `Board warned the class: ${detail}`); warn.push({ type, text: WARNING_TEXT[type]! }) }
      if (step === 'alert') alerts.push(await raise(type, 'alert', warnAt ? `${detail}. Still happening after the board's warning.` : detail))
    }
  }
  return Response.json({ signals: signals(recent, baseline), warn, alerts })
}
