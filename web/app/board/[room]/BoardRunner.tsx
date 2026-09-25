'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Player, type Seg } from '../../session/[id]/Player.tsx'

type Next = { id: string; title: string; class_name: string | null; scheduled_at: string; duration_min: number }

export function BoardRunner({ room, next, segments }: { room: string; next: Next | null; segments: Seg[] | null }) {
  const router = useRouter()
  const [clock, setClock] = useState<Date | null>(null)

  // Idle: check for newly scheduled classes every 30 s, and wake exactly when the next one is due.
  // Never refresh while a class is running.
  useEffect(() => {
    if (segments) return
    const poll = setInterval(() => router.refresh(), 30_000)
    const dueIn = next ? Date.parse(next.scheduled_at) - Date.now() : Infinity
    const wake = dueIn > 0 && dueIn < 2 ** 31 ? setTimeout(() => router.refresh(), dueIn + 500) : undefined
    const tick = setInterval(() => setClock(new Date()), 1000)
    setClock(new Date())
    return () => { clearInterval(poll); clearTimeout(wake); clearInterval(tick) }
  }, [segments, next, router])

  if (next && segments)
    return (
      <Player key={next.id} sessionId={next.id} title={next.title} segments={segments}
        auto={{ periodEnd: Date.parse(next.scheduled_at) + next.duration_min * 60_000, onDone: () => router.refresh() }} />
    )

  const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-900 p-6">
      <div className="font-hand flex h-[80vh] w-full max-w-6xl flex-col items-center justify-center gap-6 rounded-2xl border-[14px] border-[#6b4a2b] bg-[#1d3a2c] text-center text-[#f4f1e8] shadow-2xl">
        <p className="text-9xl tabular-nums">{clock ? time(clock) : ''}</p>
        {next ? (
          <>
            <p className="text-5xl text-[#f7d774]">Next: {next.title}</p>
            <p className="text-3xl">{next.class_name ? `${next.class_name} · ` : ''}starts at {time(new Date(next.scheduled_at))}</p>
          </>
        ) : (
          <p className="text-4xl text-neutral-300">No classes scheduled on this board</p>
        )}
        <p className="font-sans text-sm text-neutral-400">{room}</p>
      </div>
    </main>
  )
}
