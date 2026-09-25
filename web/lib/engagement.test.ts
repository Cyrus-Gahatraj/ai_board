import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decide, ladder, persistent, signals, type Sample } from './engagement.ts'

const run = (n: number, f: (i: number) => Partial<Sample>, t0 = 0): Sample[] =>
  Array.from({ length: n }, (_, i) => ({ at: t0 + i * 5000, persons: 4, phones: 0, ...f(i) }))

test('signals', () => {
  assert.deepEqual(signals(run(10, () => ({})), 4), [])
  assert.deepEqual(signals(run(10, () => ({ persons: 0 })), 4), ['empty_room'])
  assert.deepEqual(signals(run(10, i => ({ phones: i < 7 ? 1 : 0 })), 4), ['phones'])
  assert.deepEqual(signals(run(10, i => ({ phones: i < 3 ? 1 : 0 })), 4), []) // a glance isn't a pattern
  assert.deepEqual(signals(run(10, () => ({ persons: 2 })), 4), ['headcount_drop'])
  assert.deepEqual(signals(run(10, () => ({ persons: 1 })), 1), []) // one-person room can't "drop"
  assert.deepEqual(signals([], 4), [])
})

test('persistent needs the whole window covered', () => {
  const empty = run(8, () => ({ persons: 0 }))            // 0..35 s
  assert.deepEqual(persistent(empty, 4, 35_000), ['empty_room'])
  assert.deepEqual(persistent(empty.slice(5), 4, 35_000), []) // only 25..35 s seen: too early to alert
})

test('decide', () => {
  assert.equal(decide('correct', true, 0), 'next')
  assert.equal(decide('wrong', false, 0), 'replay')
  assert.equal(decide('partial', false, 0), 'next')
  assert.equal(decide('partial', true, 0), 'replay')
  assert.equal(decide(null, true, 0), 'replay')
  assert.equal(decide(null, false, 0), 'next')
  assert.equal(decide('wrong', true, 1), 'next') // re-check once, then move on
})

test('ladder: warn first, then alert the teacher', () => {
  const s = 1000
  assert.equal(ladder('phones', null, null, 0), 'warn')
  assert.equal(ladder('phones', 0, null, 30 * s), null)        // within grace: give the room a chance
  assert.equal(ladder('phones', 0, null, 60 * s), 'alert')     // still at it after the warning
  assert.equal(ladder('phones', 0, 60 * s, 90 * s), null)      // teacher already alerted recently
  assert.equal(ladder('phones', 0, null, 400 * s), 'warn')     // old warning: new episode, warn again
  assert.equal(ladder('empty_room', null, null, 0), 'alert')   // nobody to warn
})
