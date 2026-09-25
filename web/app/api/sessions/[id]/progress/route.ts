import { isUuid, sql } from '@/lib/db.ts'

// The classroom reports which segment is playing (and doubles as a heartbeat for "in progress").
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const b = await req.json().catch(() => ({}))
  if (!isUuid(id) || !Number.isInteger(b.segment) || b.segment < 0 || !['main', 'simple'].includes(b.variant))
    return Response.json({ error: 'bad id, segment or variant' }, { status: 400 })
  const [s] = await sql`
    update sessions set current_segment = ${b.segment}, current_variant = ${b.variant}, last_seen_at = now()
    where id = ${id} and ended_at is null returning id`
  return s ? Response.json({ ok: true }) : Response.json({ error: 'session not found or ended' }, { status: 404 })
}
