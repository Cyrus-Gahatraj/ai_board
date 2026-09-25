import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canReplay, fitPlan, nextSegment } from './period.ts'

const total = (p: ReturnType<typeof fitPlan>) => p.intro + p.concepts.reduce((a, b) => a + b, 0) + p.recap

test('fitPlan keeps the ranges when they fit', () => {
  assert.deepEqual(fitPlan(4, [9, 9, 9], 6, 50), { intro: 4, concepts: [9, 9, 9], recap: 6 })
  assert.deepEqual(fitPlan(20, [2, 30, 9], 1, 50), { intro: 5, concepts: [8, 10, 9], recap: 5 }) // clamped
})

test('fitPlan never exceeds the period', () => {
  const four = fitPlan(5, [10, 10, 10, 10], 7, 50)            // 52 min → drop the 4th concept
  assert.equal(four.concepts.length, 3)
  assert.ok(total(four) <= 50)
  for (const period of [30, 35, 40, 45]) assert.ok(total(fitPlan(5, [10, 10, 10, 10], 7, period)) <= period, `period ${period}`)
})

test('nextSegment protects the recap and stops at the bell', () => {
  const m = [4, 9, 9, 9, 6] // recap = 6 min
  assert.equal(nextSegment(2, m, 20 * 60, 50 * 60), 2)
  assert.equal(nextSegment(2, m, 44 * 60, 50 * 60), 4)  // only recap time left
  assert.equal(nextSegment(4, m, 45 * 60, 50 * 60), 4)
  assert.equal(nextSegment(4, m, 50 * 60, 50 * 60), 'end')
  assert.equal(nextSegment(5, m, 30 * 60, 50 * 60), 'end')
})

test('canReplay only if the rest still fits', () => {
  const m = [4, 9, 9, 9, 6]
  assert.equal(canReplay(1, m, 5.4, 13 * 60, 50 * 60), true)   // 13 + 5.4 + 24 = 42.4
  assert.equal(canReplay(1, m, 5.4, 25 * 60, 50 * 60), false)  // 25 + 5.4 + 24 = 54.4 > 52
})
