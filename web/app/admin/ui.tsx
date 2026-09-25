'use client'
import { useEffect, useState } from 'react'

const fmt = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60)
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`
}

// Ticks every second while the class is running; frozen once it ended.
export function Elapsed({ from, to }: { from: string; to?: string | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (to) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [to])
  return <span className="tabular-nums">{fmt(Math.max(0, ((to ? Date.parse(to) : now) - Date.parse(from)) / 1000))}</span>
}
