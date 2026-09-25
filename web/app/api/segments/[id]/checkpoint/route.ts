import { isUuid, sql } from '@/lib/db.ts'
import { decide, RULES } from '@/lib/engagement.ts'
import { gradeAnswer } from '@/lib/lesson.ts'
import { roomSignals } from '@/lib/room.ts'

// After a checkpoint: grade the answer (if any), look at the room during this segment, decide next/replay.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const b = await req.json().catch(() => ({}))
  if (!isUuid(id) || typeof b.session_id !== 'string' || !isUuid(b.session_id))
    return Response.json({ error: 'bad segment or session id' }, { status: 400 })
  const [seg] = await sql`select checkpoint from segments where id = ${id}`
  if (!seg?.checkpoint) return Response.json({ error: 'segment has no checkpoint' }, { status: 404 })

  const answer = typeof b.answer === 'string' ? b.answer.trim().slice(0, 1000) : ''
  const attempt = b.attempt === 1 ? 1 : 0
  const windowS = Math.min(Math.max(Number(b.window_s) || RULES.recentS, 10), RULES.recentS) // this segment's tail
  try {
    const [graded, signals] = await Promise.all([
      answer ? gradeAnswer(seg.checkpoint.question, seg.checkpoint.answer, answer) : null,
      roomSignals(b.session_id, windowS),
    ])
    const decision = decide(graded?.grade ?? null, signals.length > 0, attempt)
    await sql`
      insert into checkpoint_results (session_id, segment_id, attempt, answer, grade, signals, decision)
      values (${b.session_id}, ${id}, ${attempt}, ${answer || null}, ${graded?.grade ?? null}, ${signals}, ${decision})`
    return Response.json({ decision, grade: graded?.grade ?? null, feedback: graded?.feedback ?? null, signals })
  } catch (e) {
    console.error('checkpoint failed', id, e)
    return Response.json({ error: (e as Error).message }, { status: 502 })
  }
}
