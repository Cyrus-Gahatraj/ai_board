// Pure timing helpers for segment scripts. Shared by the generator (server) and the player (client).

export type BoardType = 'heading' | 'line' | 'label' | 'formula'
export type BoardAction = { type: BoardType; text: string; at: number } // at: est. seconds from segment start
export type Beat = { say: string; start: number; end: number; board: BoardAction[] } // est. seconds at WPM
export type Script = { wpm: number; target_seconds: number; est_seconds: number; words: number; beats: Beat[] }
export type RawBeat = { say: string; board: { type: BoardType; text: string }[] }

export const WPM = 140
export const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length
const r1 = (n: number) => Math.round(n * 10) / 10

// Estimated timeline: each beat lasts words/WPM; its board actions are spread evenly across it.
export function timeBeats(raw: RawBeat[], targetSeconds: number, wpm = WPM): Script {
  let t = 0
  const beats = raw.map(b => {
    const dur = (wordCount(b.say) / wpm) * 60
    const board = b.board.map((a, i) => ({ ...a, at: r1(t + (dur * i) / b.board.length) }))
    const beat = { say: b.say, start: r1(t), end: r1(t + dur), board }
    t += dur
    return beat
  })
  const words = raw.reduce((n, b) => n + wordCount(b.say), 0)
  return { wpm, target_seconds: targetSeconds, est_seconds: r1(t), words, beats }
}

// What the board renders: an action pinned to the real (audio) clock.
export type BoardItem = { id: string; type: BoardType; text: string; start: number; end: number }

// Once a beat's real audio duration is known, rescale its estimated action times onto the real clock.
// Each action "writes" at ~22 chars/s, but never runs past the next action or the end of the beat.
export function placeBeat(beat: Beat, beatIdx: number, realStart: number, realDur: number): BoardItem[] {
  const est = beat.end - beat.start || 1
  const starts = beat.board.map(a => realStart + ((a.at - beat.start) / est) * realDur)
  return beat.board.map((a, i) => {
    const limit = i + 1 < starts.length ? starts[i + 1] : realStart + realDur
    return { id: `${beatIdx}.${i}`, type: a.type, text: a.text, start: starts[i], end: Math.min(starts[i] + a.text.length / 22, limit) }
  })
}
