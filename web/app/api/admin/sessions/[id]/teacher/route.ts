import { isUuid, sql } from '@/lib/db.ts'

// Teacher joins (board pauses the lesson and shows the call) or leaves (board resumes). Admin-only via middleware.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const b = await req.json().catch(() => ({}))
  if (!isUuid(id) || typeof b.present !== 'boolean') return Response.json({ error: 'bad id or present' }, { status: 400 })
  const [s] = await sql`update sessions set teacher_present = ${b.present} where id = ${id} and ended_at is null returning daily_room_url`
  return s ? Response.json(s) : Response.json({ error: 'session not found or ended' }, { status: 404 })
}
