// Usage: npm run db:migrate   (every statement is idempotent; safe to re-run)
import { readdir } from 'node:fs/promises'
import { sql } from '../lib/db.ts'

const dir = new URL('../../db/', import.meta.url)
for (const f of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) {
  await sql.file(new URL(f, dir).pathname)
  console.log(`applied ${f}`)
}
await sql.end()
