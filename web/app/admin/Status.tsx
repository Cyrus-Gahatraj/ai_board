import type { SessionRow } from '@/lib/admin.ts'
import { TeacherCall } from './TeacherCall.tsx'

// "waiting": the board is up (heartbeat from its camera) but students haven't arrived yet.
export const status = (s: SessionRow) => {
  const recent = s.last_seen_at && Date.now() - +s.last_seen_at < 2 * 60_000
  if (s.live) return 'live'
  if (s.ended_at) return 'ended'
  if (s.started_at) return 'stalled'
  if (recent) return 'waiting'
  if (s.scheduled_at && +s.scheduled_at + s.duration_min * 60_000 < Date.now()) return 'missed'
  return s.scheduled_at ? 'scheduled' : 'not started'
}

const STYLE: Record<string, string> = {
  live: 'bg-emerald-700 text-white',
  waiting: 'bg-sky-800 text-sky-100',
  stalled: 'bg-amber-800 text-amber-100',
  missed: 'bg-red-900 text-red-100',
  ended: 'bg-neutral-700 text-neutral-300',
  scheduled: 'bg-neutral-800 text-neutral-300',
  'not started': 'bg-neutral-800 text-neutral-400',
}
const TITLE: Record<string, string> = {
  waiting: 'The board is on and waiting for students to arrive',
  stalled: 'Started, but the board has not checked in for 2+ minutes',
  missed: 'The period is over and the class never started',
}

export function Status({ s }: { s: SessionRow }) {
  const st = status(s)
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${STYLE[st]}`} title={TITLE[st]}>
      {st === 'live' && '● '}{st === 'waiting' ? 'waiting for class' : st}
    </span>
  )
}

export function JoinButton({ s }: { s: SessionRow }) {
  if (!s.live) return null
  return <TeacherCall id={s.id} url={s.daily_room_url} present={s.teacher_present} />
}
