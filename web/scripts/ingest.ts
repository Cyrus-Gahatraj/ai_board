// Usage: npm run ingest -- [path/to.pdf] [--dry-run]
import { readFile } from 'node:fs/promises'
import { basename, relative, resolve } from 'node:path'
import { extractText, getDocumentProxy } from 'unpdf'
import { chunkPages } from '../lib/rag.ts'
import { embed } from '../lib/llm.ts'
import { sql } from '../lib/db.ts'

const args = process.argv.slice(2)
const path = resolve(args.find(a => !a.startsWith('--')) ?? '../syllabus/document.pdf')
const storagePath = relative(resolve('..'), path) // e.g. syllabus/document.pdf

const pdf = await getDocumentProxy(new Uint8Array(await readFile(path)))
const { text: pages } = await extractText(pdf, { mergePages: false })
const chunks = chunkPages(pages)
console.log(`${storagePath}: ${pages.length} pages → ${chunks.length} chunks`)

if (args.includes('--dry-run')) {
  for (const c of chunks)
    console.log(`\n--- #${c.idx} p${c.page}-${c.page_end} (${c.content.split(/\s+/).length} words)\n${c.content}`)
  await sql.end()
  process.exit(0)
}

const embeddings = await embed(chunks.map(c => c.content), 'RETRIEVAL_DOCUMENT')

// One transaction: re-running replaces the document (chunks cascade), and a failure leaves the old copy intact.
const docId = await sql.begin(async tx => {
  await tx`delete from documents where storage_path = ${storagePath}`
  const [doc] = await tx`insert into documents (title, storage_path) values (${basename(path)}, ${storagePath}) returning id`
  await tx`insert into chunks ${tx(chunks.map((c, i) => ({ ...c, document_id: doc.id, embedding: embeddings[i] })))}`
  return doc.id
})
console.log(`stored document ${docId} with ${chunks.length} chunks`)
await sql.end()
