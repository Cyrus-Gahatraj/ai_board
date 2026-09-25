import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { isUuid, sql } from '@/lib/db.ts'
import { RECORDINGS_DIR, recordingPath } from '@/lib/recordings.ts'

const MAX_CHUNK = 20 * 1024 * 1024
const nextSeq = new Map<string, number>() // per session: which chunk we expect next

// MediaRecorder chunks, uploaded in order (?seq=0,1,2…) and appended to recordings/<session>.webm.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const seq = Number(new URL(req.url).searchParams.get('seq'))
  if (!isUuid(id) || !Number.isInteger(seq) || seq < 0) return Response.json({ error: 'bad id or seq' }, { status: 400 })

  const expected = nextSeq.get(id) ?? seq // unknown (e.g. after a server restart): trust the client's order
  if (seq < expected) return Response.json({ ok: true, duplicate: true }) // a retried chunk we already have
  if (seq > expected) return Response.json({ error: `expected chunk ${expected}` }, { status: 409 })

  const buf = Buffer.from(await req.arrayBuffer())
  if (buf.length > MAX_CHUNK) return Response.json({ error: 'chunk too large' }, { status: 413 })
  if (seq === 0) {
    const [s] = await sql`select 1 from sessions where id = ${id}`
    if (!s) return Response.json({ error: 'session not found' }, { status: 404 })
    await mkdir(RECORDINGS_DIR, { recursive: true })
    await writeFile(recordingPath(id), buf)
  } else {
    await appendFile(recordingPath(id), buf)
  }
  nextSeq.set(id, seq + 1)
  return Response.json({ ok: true })
}
