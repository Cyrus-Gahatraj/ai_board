import { sql } from '@/lib/db.ts'

export const dynamic = 'force-dynamic'

// Server-sent events for the dashboard: relays Postgres NOTIFY on channel 'board'
// (fired by triggers on alerts and sessions, see db/0004_admin.sql). Gated by middleware.
export async function GET(req: Request) {
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(ctl) {
      const send = (s: string) => { try { ctl.enqueue(enc.encode(s)) } catch { /* client already gone */ } }
      const sub = await sql.listen('board', payload => send(`data: ${payload}\n\n`))
      const ping = setInterval(() => send(': ping\n\n'), 25_000) // keep proxies from closing an idle stream
      send(': connected\n\n')
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
