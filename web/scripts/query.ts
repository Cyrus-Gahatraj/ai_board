// Usage: npm run rag:query -- "topic string" [topK]
import { retrieveSyllabusContext } from '../lib/rag.ts'
import { sql } from '../lib/db.ts'

const [query = 'for and while loops in Python', k = '3'] = process.argv.slice(2)
console.log(`query: "${query}"`)
for (const m of await retrieveSyllabusContext(query, Number(k))) {
  const pages = m.page === m.page_end ? `p${m.page}` : `p${m.page}-${m.page_end}`
  console.log(`\n#${m.idx}  ${pages}  similarity=${m.similarity.toFixed(3)}\n${m.content}`)
}
await sql.end()
