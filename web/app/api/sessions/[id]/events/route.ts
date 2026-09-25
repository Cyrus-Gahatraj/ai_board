import { isUuid, sql } from '@/lib/db.ts'

export const dynamic = 'force-dynamic'

// Server-sent events for one board: tells it when the teacher joins or leaves the video call.
// Only sends that one flag, so this can stay unauthenticated like the rest of the board's routes.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) return new Response('bad session id', { status: 400 })
  const [s] = await sql`select teacher_present, daily_room_url from sessions where id = ${id}`
  if (!s) return new Response('not found', { status: 404 })

  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(ctl) {
      const send = (o: object) => { try { ctl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`)) } catch { /* gone */ } }
      send({ teacher_present: s.teacher_present, daily_room_url: s.daily_room_url })
      const sub = await sql.listen('board', payload => {
        const { table, row } = JSON.parse(payload)
        if (table === 'sessions' && row.id === id) send({ teacher_present: row.teacher_present, daily_room_url: row.daily_room_url })
      })
      const ping = setInterval(() => { try { ctl.enqueue(enc.encode(': ping\n\n')) } catch { /* gone */ } }, 25_000)
      req.signal.addEventListener('abort', () => {
        clearInterval(ping)
        sub.unlisten().catch(() => {})
        try { ctl.close() } catch { /* already closed */ }
      })
    },
  })
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' },
  })
}
