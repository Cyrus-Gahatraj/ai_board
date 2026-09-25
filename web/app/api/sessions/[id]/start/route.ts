import { createDailyRoom } from '@/lib/daily.ts'
import { isUuid, sql } from '@/lib/db.ts'

// Marks the class started (with the headcount the board saw), and gives it a Daily room so a teacher can drop in.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'bad session id' }, { status: 400 })
  const b = await req.json().catch(() => ({}))
  const attendance = Number.isInteger(b.attendance) && b.attendance >= 0 && b.attendance <= 500 ? b.attendance : null
  const [s] = await sql`
    update sessions set started_at = coalesce(started_at, now()), last_seen_at = now(),
      attendance = coalesce(attendance, ${attendance})
    where id = ${id} returning started_at, daily_room_url`
  if (!s) return Response.json({ error: 'session not found' }, { status: 404 })
  if (s.daily_room_url) return Response.json(s)

  const room = await createDailyRoom()
  if (!room.url) {
    console.warn('no Daily room:', room.reason)
    return Response.json({ ...s, daily_error: room.reason })
  }
  await sql`update sessions set daily_room_url = ${room.url} where id = ${id}`
  return Response.json({ ...s, daily_room_url: room.url })
}
