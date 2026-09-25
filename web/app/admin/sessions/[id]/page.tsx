import Link from 'next/link'
import { notFound } from 'next/navigation'
import { checkpointResults, getSession, recentAlerts, roomSummary, sessionSegments } from '@/lib/admin.ts'
import { isUuid } from '@/lib/db.ts'
import { JoinButton, Status } from '../../Status.tsx'
import { Elapsed } from '../../ui.tsx'

export const dynamic = 'force-dynamic'

const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const GRADE: Record<string, string> = { correct: 'text-emerald-400', partial: 'text-amber-300', wrong: 'text-red-400' }

export default async function SessionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const s = await getSession(id)
  if (!s) notFound()
  const [segments, results, alerts, room] = await Promise.all([sessionSegments(id), checkpointResults(id), recentAlerts(id, 30), roomSummary(id)])

  // One timeline of what happened, newest first.
  const events = [
    ...alerts.map(a => ({ at: a.created_at, kind: a.level === 'alert' ? 'alert' as const : 'warning' as const, text: a.detail, label: `${a.level === 'alert' ? 'teacher alerted' : 'board warned'} · ${a.type.replaceAll('_', ' ')}` })),
    ...results.map(r => ({
      at: r.created_at, kind: 'checkpoint' as const, label: `checkpoint · segment ${segments.find(g => g.id === r.segment_id)!.idx + 1}${r.attempt ? ' (retry)' : ''}`,
      text: `${r.answer ? `“${r.answer}” → ${r.grade}` : 'No answer'}${r.signals.length ? ` · room: ${r.signals.join(', ').replaceAll('_', ' ')}` : ''} → ${r.decision === 'replay' ? 'replayed simpler' : 'moved on'}`,
    })),
    ...(s.started_at ? [{ at: s.started_at, kind: 'info' as const, label: 'started', text: `Class started${s.attendance !== null ? ` with ${s.attendance} students in the room` : ''}` }] : []),
    ...(s.ended_at ? [{ at: s.ended_at, kind: 'info' as const, label: 'ended', text: 'Class ended' }] : []),
  ].sort((a, b) => +b.at - +a.at)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/admin" className="text-sm text-neutral-400 hover:text-neutral-200">← All sessions</Link>
          <h1 className="mt-1 text-2xl font-semibold">{s.title}</h1>
          <p className="text-sm text-neutral-400">{s.class_name ?? 'Unnamed class'} · {s.topic}</p>
          <p className="mt-1 text-sm text-neutral-400">
            {s.room ? <>Board <a href={`/board/${s.room}`} target="_blank" className="text-neutral-200 underline">{s.room}</a></> : 'No room'}
            {s.scheduled_at && <> · {s.scheduled_at.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</>}
            {' '}· {s.duration_min} min period
            {' '}· scripts ready {s.scripts_ready}/{segments.length}
            {' '}· <a href={`/session/${s.id}`} target="_blank" className="text-neutral-200 underline">Preview lesson ↗</a>
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Status s={s} />
          {s.started_at && <span className="text-neutral-300"><Elapsed from={s.started_at.toISOString()} to={s.ended_at?.toISOString() ?? (s.live ? null : s.last_seen_at?.toISOString())} /></span>}
          <JoinButton s={s} />
        </div>
      </header>

      {s.recording_url && (
        <section className="rounded-xl bg-neutral-800/60 p-4">
          <h2 className="mb-3 text-sm uppercase tracking-wide text-neutral-400">Recording</h2>
          <video src={s.recording_url} controls preload="metadata" className="w-full max-w-3xl rounded-lg bg-black" />
          <a href={s.recording_url} target="_blank" className="mt-2 inline-block text-sm text-emerald-400 underline">Open recording ↗</a>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="flex flex-col gap-2">
          <h2 className="text-sm uppercase tracking-wide text-neutral-400">Lesson plan</h2>
          {segments.map(g => {
            const active = s.live && s.current_segment === g.idx
            const done = s.ended_at || (s.current_segment !== null && g.idx < s.current_segment)
            const rs = results.filter(r => r.segment_id === g.id)
            return (
              <div key={g.id} className={`rounded-lg px-4 py-3 ${active ? 'bg-emerald-800' : 'bg-neutral-800'} ${done && !active ? 'opacity-70' : ''}`}>
                <span className="text-xs uppercase text-neutral-400">
                  {g.idx + 1}. {g.kind} · {g.minutes} min{active && ` · now playing${s.current_variant === 'simple' ? ' (simpler replay)' : ''}`}
                </span>
                <span className="block">{g.title}</span>
                {g.checkpoint && <span className="mt-1 block text-sm text-neutral-400">Checkpoint: {g.checkpoint.question}</span>}
                {rs.map((r, i) => (
                  <span key={i} className="mt-1 block text-sm">
                    <span className={r.grade ? GRADE[r.grade] : 'text-neutral-500'}>{r.attempt ? 'Retry' : 'Answer'}: {r.answer ? `“${r.answer}” (${r.grade})` : 'none'}</span>
                    <span className="text-neutral-400"> → {r.decision === 'replay' ? 'replayed simpler' : 'moved on'}</span>
                  </span>
                ))}
              </div>
            )
          })}
        </section>

        <aside className="flex flex-col gap-6">
          <section>
            <h2 className="mb-2 text-sm uppercase tracking-wide text-neutral-400">Room · last 10 min</h2>
            {room.samples ? (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-neutral-800 p-3"><p className="text-2xl tabular-nums">{room.last_persons}</p><p className="text-xs text-neutral-400">people now</p></div>
                <div className="rounded-lg bg-neutral-800 p-3"><p className="text-2xl tabular-nums">{s.attendance ?? '—'}</p><p className="text-xs text-neutral-400">at start</p></div>
                <div className="rounded-lg bg-neutral-800 p-3"><p className="text-2xl tabular-nums">{s.peak_persons ?? '—'}</p><p className="text-xs text-neutral-400">most seen</p></div>
                <div className="rounded-lg bg-neutral-800 p-3"><p className="text-2xl tabular-nums">{room.avg_persons}</p><p className="text-xs text-neutral-400">avg people</p></div>
                <div className="rounded-lg bg-neutral-800 p-3"><p className="text-2xl tabular-nums">{room.phone_share}%</p><p className="text-xs text-neutral-400">time phones seen</p></div>
              </div>
            ) : <p className="text-sm text-neutral-500">No camera readings in the last 10 minutes.</p>}
          </section>
          <section>
            <h2 className="mb-2 text-sm uppercase tracking-wide text-neutral-400">Events</h2>
            <ol className="flex flex-col gap-2">
              {events.map((e, i) => (
                <li key={i} className="rounded-lg bg-neutral-800 px-3 py-2 text-sm">
                  <span className={`text-xs font-semibold uppercase tracking-wide ${e.kind === 'alert' ? 'text-red-400' : e.kind === 'warning' ? 'text-amber-400' : e.kind === 'checkpoint' ? 'text-emerald-400' : 'text-neutral-400'}`}>{e.label}</span>
                  <span className="float-right text-xs text-neutral-500">{time(e.at)}</span>
                  <span className="block text-neutral-200">{e.text}</span>
                </li>
              ))}
              {!events.length && <li className="text-sm text-neutral-500">Nothing yet.</li>}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  )
}
