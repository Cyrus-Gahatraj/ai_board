// Pure engagement policy for the room camera. All thresholds live here.

export type Sample = { at: number; persons: number; phones: number } // at: ms epoch
export type Signal = 'empty_room' | 'phones' | 'headcount_drop'
export type Grade = 'correct' | 'partial' | 'wrong' | null

export const RULES = {
  persistS: 30,      // a signal must hold this long before it becomes an alert
  recentS: 90,       // how far back the checkpoint looks for distraction
  share: 0.6,        // fraction of samples in a window that must show the signal
  dropRatio: 0.7,    // headcount below 70% of the class's usual size
  dedupeS: 120,      // don't repeat the same alert type within this window
}

export const DETAIL: Record<Signal, string> = {
  empty_room: 'No one visible in front of the board',
  phones: 'Phones visible in the room',
  headcount_drop: 'Fewer students in the room than usual',
}

// ponytail: COCO RF-DETR sees people and phones, not gaze; these are proxies for attention.
// `baseline` = the class's usual headcount (e.g. 80th percentile of persons this session).
export function signals(samples: Sample[], baseline: number): Signal[] {
  if (!samples.length) return []
  const share = (f: (s: Sample) => boolean) => samples.filter(f).length / samples.length
  const out: Signal[] = []
  if (share(s => s.persons === 0) >= RULES.share) out.push('empty_room')
  if (share(s => s.phones > 0) >= RULES.share) out.push('phones')
  if (baseline >= 2 && share(s => s.persons > 0 && s.persons < baseline * RULES.dropRatio) >= RULES.share)
    out.push('headcount_drop')
  return out
}

// Signals that have held for the whole persistence window, ending at `now`.
// Needs samples reaching back to the start of the window, so a fresh session can't alert instantly.
export function persistent(samples: Sample[], baseline: number, now: number): Signal[] {
  const from = now - RULES.persistS * 1000
  const win = samples.filter(s => s.at >= from)
  if (!win.length || win[0].at > from + 10_000) return []
  return signals(win, baseline)
}

// Discipline ladder: the board warns the room aloud first; if the signal is still there after the grace
// period, the teacher is alerted. An empty room has no one to warn, so it goes straight to the teacher.
export const WARN_FIRST: Record<Signal, boolean> = { phones: true, headcount_drop: true, empty_room: false }
export const LADDER = { graceS: 60, episodeS: 300 } // a warning older than 5 min starts a fresh episode

export const WARNING_TEXT: Partial<Record<Signal, string>> = {
  phones: 'I can see some phones out. Please put your phones away so we can continue.',
  headcount_drop: 'It looks like some of you have left your seats. Please come back and stay with the class.',
}

export function ladder(type: Signal, lastWarnAt: number | null, lastAlertAt: number | null, now: number): 'warn' | 'alert' | null {
  if (lastAlertAt !== null && now - lastAlertAt < RULES.dedupeS * 1000) return null // teacher already told
  if (!WARN_FIRST[type]) return 'alert'
  if (lastWarnAt === null || now - lastWarnAt > LADDER.episodeS * 1000) return 'warn'
  return now - lastWarnAt >= LADDER.graceS * 1000 ? 'alert' : null
}

// After a checkpoint: move on, or replay a simpler version of the segment (only once).
export function decide(grade: Grade, distracted: boolean, attempt: number): 'next' | 'replay' {
  if (attempt > 0 || grade === 'correct') return 'next'
  if (grade === 'wrong') return 'replay'
  return distracted ? 'replay' : 'next' // partial or no answer: the room's engagement breaks the tie
}
