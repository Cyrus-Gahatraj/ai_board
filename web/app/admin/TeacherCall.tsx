'use client'
import { useState } from 'react'

// Join: the board pauses the lesson and puts the call full-screen; the teacher's call opens in a new tab.
// Leave: the board takes the call down and carries on teaching.
export function TeacherCall({ id, url, present }: { id: string; url: string | null; present: boolean }) {
  const [busy, setBusy] = useState(false)
  const set = async (on: boolean) => {
    setBusy(true)
    const tab = on && url ? window.open(url, '_blank', 'noopener') : null // open inside the click, before awaiting
    const r = await fetch(`/api/admin/sessions/${id}/teacher`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ present: on }),
    }).catch(() => null)
    if (!r?.ok) tab?.close()
    setBusy(false) // the page re-renders from the live event with the new state
  }
  if (!url) return <span className="whitespace-nowrap text-xs text-neutral-500" title="Set DAILY_API_KEY; the room is created when the class starts">No video room</span>
  return present ? (
    <span className="flex items-center gap-2 whitespace-nowrap">
      <a href={url} target="_blank" rel="noreferrer" className="text-sm text-emerald-400 underline">On call ↗</a>
      <button onClick={() => set(false)} disabled={busy} className="rounded-lg bg-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-600 disabled:opacity-50">
        Leave & resume lesson
      </button>
    </span>
  ) : (
    <button onClick={() => set(true)} disabled={busy}
      className="whitespace-nowrap rounded-lg bg-[#f7d774] px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-[#f9e08f] disabled:opacity-50">
      Join live class ↗
    </button>
  )
}
