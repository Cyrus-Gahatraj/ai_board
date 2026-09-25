import { sql } from './db.ts'
import { embed } from './llm.ts'

export type Chunk = { idx: number; page: number; page_end: number; content: string }
export type Match = Chunk & { id: number; document_id: string; similarity: number }

// ponytail: tokens estimated as words × 1.33 (English). Use a real tokenizer if chunk sizes matter more.
// 480 words ≈ 640 tokens, 60-word (~80 token) overlap. Line breaks are kept so "Unit II" headings survive.
export function chunkPages(pages: string[], size = 480, overlap = 60): Chunk[] {
  const words = pages.flatMap((text, p) =>
    text.split('\n').flatMap(line =>
      line.split(/\s+/).filter(Boolean).map((w, i, all) => ({ w: w + (i === all.length - 1 ? '\n' : ' '), page: p + 1 }))))
  const chunks: Chunk[] = []
  for (let start = 0; start < words.length; start += size - overlap) {
    const win = words.slice(start, start + size)
    chunks.push({ idx: chunks.length, page: win[0].page, page_end: win.at(-1)!.page, content: win.map(x => x.w).join('').trim() })
    if (start + size >= words.length) break
  }
  return chunks
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return dot / (Math.sqrt(na * nb) || 1)
}

// ponytail: scores every chunk in Node on each query. Fine to ~10k chunks; past that, move to pgvector.
export async function retrieveSyllabusContext(query: string, topK = 5, documentId?: string): Promise<Match[]> {
  query = query.trim()
  if (!query) throw new Error('query is empty')
  const [q] = await embed([query], 'RETRIEVAL_QUERY')
  const rows = await sql<(Chunk & { id: string; document_id: string; embedding: number[] })[]>`
    select id, document_id, idx, page, page_end, content, embedding from chunks
    ${documentId ? sql`where document_id = ${documentId}` : sql``}`
  return rows
    .map(({ embedding, ...r }) => ({ ...r, id: Number(r.id), similarity: cosine(q, embedding) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, Math.min(Math.max(1, Math.floor(topK)), 20))
}
