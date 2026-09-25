// Pure time-budget rules: a lesson fills the period but never runs past it.

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number(n) || lo))
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
const half = (n: number) => Math.round(n * 2) / 2

// Fit the model's suggested minutes into the period: intro 3-5, concepts 8-10, recap 5-7.
// Over budget: drop the 4th concept first, then shrink everything proportionally.
export function fitPlan(intro: number, concepts: number[], recap: number, periodMin: number) {
  let i = clamp(intro, 3, 5), r = clamp(recap, 5, 7)
  let c = concepts.slice(0, 4).map(m => clamp(m, 8, 10))
  if (c.length > 3 && i + sum(c) + r > periodMin) c = c.slice(0, 3)
  const total = i + sum(c) + r
  if (total > periodMin) {
    const k = periodMin / total
    i = half(i * k); r = half(r * k); c = c.map(m => half(m * k))
    // rounding up can overshoot by a little; take it from the concepts
    for (let j = 0; i + sum(c) + r > periodMin; j = (j + 1) % c.length) c[j] -= 0.5
  }
  return { intro: i, concepts: c, recap: r }
}

// Which segment to play next, given where we are and how much of the period is left.
// The recap (last segment) is protected: when only its time remains, jump to it.
export function nextSegment(i: number, minutes: number[], elapsedS: number, periodS: number): number | 'end' {
  const last = minutes.length - 1
  if (i > last || elapsedS >= periodS) return 'end'
  if (i < last && elapsedS + minutes[last] * 60 >= periodS) return last
  return i
}

// A simplified replay only happens if it still leaves room for the rest of the lesson (2 min slack).
export function canReplay(i: number, minutes: number[], replayMin: number, elapsedS: number, periodS: number) {
  return elapsedS + (replayMin + sum(minutes.slice(i + 1))) * 60 <= periodS + 120
}
