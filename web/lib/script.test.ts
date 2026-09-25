import assert from 'node:assert/strict'
import { test } from 'node:test'
import { placeBeat, timeBeats } from './script.ts'

const words = (n: number) => Array(n).fill('w').join(' ')

test('timeBeats sizes beats at 140 wpm and spreads board actions', () => {
  const s = timeBeats([
    { say: words(70), board: [{ type: 'heading', text: 'Loops' }, { type: 'line', text: 'for x in y' }] }, // 30 s
    { say: words(14), board: [] },                                                                         // 6 s
  ], 60)
  assert.equal(s.words, 84)
  assert.equal(s.est_seconds, 36)
  assert.deepEqual(s.beats.map(b => [b.start, b.end]), [[0, 30], [30, 36]])
  assert.deepEqual(s.beats[0].board.map(a => a.at), [0, 15])
})

test('placeBeat rescales onto real audio time and never overlaps the next action', () => {
  const [beat] = timeBeats([{ say: words(70), board: [{ type: 'line', text: 'x'.repeat(300) }, { type: 'line', text: 'hi' }] }], 30).beats
  const items = placeBeat(beat, 3, 100, 20) // audio really lasts 20 s, starts at t=100
  assert.deepEqual(items.map(i => i.start), [100, 110])
  assert.equal(items[0].end, 110)          // 300 chars would take ~14 s; capped by the next action at 110
  assert.ok(items[1].end <= 120)
  assert.equal(items[1].id, '3.1')
})
