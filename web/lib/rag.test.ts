import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chunkPages, cosine } from './rag.ts'

test('chunkPages windows with overlap and tracks pages', () => {
  const page = (n: number, from: number) => Array.from({ length: n }, (_, i) => `w${from + i}`).join(' ')
  const chunks = chunkPages([page(6, 0), page(6, 6)], 5, 2) // 12 words, step 3

  assert.deepEqual(chunks.map(c => c.content.split(/\s+/)[0]), ['w0', 'w3', 'w6', 'w9'])
  assert.equal(chunks.at(-1)!.content.split(/\s+/).at(-1), 'w11') // nothing dropped at the tail
  assert.deepEqual(chunks.map(c => [c.page, c.page_end]), [[1, 1], [1, 2], [2, 2], [2, 2]])
  assert.deepEqual(chunkPages(['', '  ']), [])
})

test('chunkPages keeps line breaks', () => {
  assert.equal(chunkPages(['Unit I\nLoops and  ifs'])[0].content, 'Unit I\nLoops and ifs')
})

test('cosine', () => {
  assert.equal(cosine([1, 0], [2, 0]), 1)
  assert.equal(cosine([1, 0], [0, 3]), 0)
  assert.equal(cosine([1, 0], [-1, 0]), -1)
  assert.equal(cosine([0, 0], [1, 0]), 0) // zero vector doesn't NaN
})
