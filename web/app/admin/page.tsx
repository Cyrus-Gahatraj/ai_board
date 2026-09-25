import Link from 'next/link'
import { listSessions, recentAlerts } from '@/lib/admin.ts'
import { JoinButton, Status } from './Status.tsx'
import { Elapsed } from './ui.tsx'

export const dynamic = 'force-dynamic'

const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const when = (d: Date) => d.toDateString() === new Date().toDateString() ? time(d) : d.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default async function Dashboard() {
  const [sessions, alerts] = await Promise.all([listSessions(), recentAlerts()])
  const live = sessions.filter(s => s.live).length

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">Sessions <span className="text-sm font-normal text-neutral-400">· {live} live</span></h1>
        <div className="overflow-hidden rounded-xl bg-neutral-800/60">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-neutral-400">
              <tr><th className="px-4 py-3">Class · lesson</th><th className="px-4 py-3">Room · time</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Present</th><th className="px-4 py-3">Elapsed</th><th className="px-4 py-3">Current segment</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody>
              {sessions.map(s => (
                <tr key={s.id} className="border-t border-neutral-700/60 hover:bg-neutral-700/40">
                  <td className="px-4 py-3">
                    <Link href={`/admin/sessions/${s.id}`} className="block">
                      <span className="text-neutral-400">{s.class_name ?? 'Unnamed class'} · </span>{s.title}
                      <span className="block text-xs text-neutral-500">{s.topic}</span>
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-neutral-300">{s.room ?? '—'}<span className="block text-xs text-neutral-500">{s.scheduled_at ? when(s.scheduled_at) : 'unscheduled'}</span></td>
                  <td className="px-4 py-3"><Status s={s} />{s.alert_count > 0 && <span className="ml-2 text-xs text-amber-400">⚠ {s.alert_count}</span>}</td>
                  <td className="px-4 py-3 tabular-nums">{s.attendance ?? '—'}</td>
                  <td className="px-4 py-3">
                    {s.started_at ? <Elapsed from={s.started_at.toISOString()} to={s.ended_at?.toISOString() ?? (s.live ? null : s.last_seen_at?.toISOString())} /> : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {s.current_segment !== null && !s.ended_at
                      ? <>{s.current_segment + 1}/{s.segment_count} · {s.segment_title}{s.current_variant === 'simple' && <span className="text-amber-300"> (simpler replay)</span>}</>
                      : <span className="text-neutral-500">{s.ended_at ? `done · ${s.segment_count} segments` : '—'}</span>}
                  </td>
                  <td className="px-4 py-3 text-right"><JoinButton s={s} /></td>
                </tr>
              ))}
              {!sessions.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-neutral-500">No lessons yet. <Link href="/admin/new" className="underline">Plan one</Link>.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="flex flex-col gap-3">
        <h2 className="text-sm uppercase tracking-wide text-neutral-400">Alerts</h2>
        {alerts.map(a => (
          <Link key={a.id} href={`/admin/sessions/${a.session_id}`} className="rounded-lg bg-neutral-800 px-4 py-3 hover:bg-neutral-700">
            <span className="text-xs font-semibold uppercase tracking-wide text-amber-400">⚠ {a.type.replaceAll('_', ' ')}</span>
            <span className="float-right text-xs text-neutral-500">{time(a.created_at)}</span>
            <span className="mt-1 block text-sm text-neutral-200">{a.detail}</span>
            <span className="mt-1 block text-xs text-neutral-500">{a.room ? `${a.room} · ` : ''}{a.class_name ?? 'Unnamed class'} · {a.title}</span>
          </Link>
        ))}
        {!alerts.length && <p className="text-sm text-neutral-500">No alerts. They appear here the moment a class needs attention.</p>}
      </aside>
    </div>
  )
}
