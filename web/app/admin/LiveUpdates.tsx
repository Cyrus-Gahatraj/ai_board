'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

type Alert = { id: string; session_id: string; type: string; detail: string }

// Subscribes to /api/admin/events: toasts new alerts and re-renders the (server) page on any change.
export function LiveUpdates() {
  const router = useRouter()
  const [toasts, setToasts] = useState<Alert[]>([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const es = new EventSource('/api/admin/events')
    let pending: ReturnType<typeof setTimeout> | undefined
    const refresh = () => { clearTimeout(pending); pending = setTimeout(() => router.refresh(), 300) } // coalesce bursts
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false) // EventSource reconnects on its own
    es.onmessage = e => {
      const { table, row } = JSON.parse(e.data)
      if (table === 'alerts' && row.level === 'alert') { // warnings are handled by the board itself
        setToasts(ts => [...ts.slice(-3), row])
        setTimeout(() => setToasts(ts => ts.filter(t => t.id !== row.id)), 12_000)
      }
      refresh()
    }
    const poll = setInterval(() => router.refresh(), 30_000) // notices classrooms that went quiet (no event for that)
    return () => { es.close(); clearInterval(poll); clearTimeout(pending) }
  }, [router])

  return (
    <>
      <span className={`text-xs ${connected ? 'text-emerald-400' : 'text-neutral-500'}`}>{connected ? '● live' : '○ connecting…'}</span>
      <div className="fixed bottom-6 right-6 z-50 flex w-96 flex-col gap-2" aria-live="polite">
        {toasts.map(t => (
          <Link key={t.id} href={`/admin/sessions/${t.session_id}`}
            className="rounded-xl border border-amber-500/40 bg-neutral-800 p-4 shadow-2xl hover:bg-neutral-700">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-400">⚠ {t.type.replaceAll('_', ' ')}</p>
            <p className="mt-1 text-sm text-neutral-200">{t.detail}</p>
            <p className="mt-2 text-xs text-emerald-400">Open session →</p>
          </Link>
        ))}
      </div>
    </>
  )
}
