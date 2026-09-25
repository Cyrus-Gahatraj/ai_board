import { stat } from 'node:fs/promises'
import { isUuid, sql } from '@/lib/db.ts'
import { sendRecordingEmail } from '@/lib/email.ts'
import { recordingPath } from '@/lib/recordings.ts'

// Called once the classroom has flushed the last recording chunk.
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'bad session id' }, { status: 400 })
  const [before] = await sql`
    select s.recording_url, lp.title from sessions s join lesson_plans lp on lp.session_id = s.id where s.id = ${id}`
  if (!before) return Response.json({ error: 'session not found' }, { status: 404 })

  const hasFile = !!(await stat(recordingPath(id)).catch(() => null))
  const url = hasFile ? `/recordings/${id}.webm` : null
  await sql`update sessions set ended_at = coalesce(ended_at, now()), recording_url = coalesce(${url}, recording_url) where id = ${id}`

  // Email only the first time a recording lands, so re-ending a session doesn't spam.
  const email = url && !before.recording_url
    ? await sendRecordingEmail(before.title, `${process.env.PUBLIC_URL ?? 'http://localhost:3000'}${url}`)
    : { sent: false, reason: url ? 'already sent' : 'no recording' }
  if (!email.sent) console.warn('recording email not sent:', email.reason)
  return Response.json({ recording_url: url ?? before.recording_url, email })
}
