import { isUuid } from '@/lib/db.ts'
import { segmentScript } from '@/lib/lesson.ts'

// Returns the segment's script (?variant=simple for the simplified replay), generating and caching it on first request.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'bad segment id' }, { status: 400 })
  const variant = new URL(req.url).searchParams.get('variant') === 'simple' ? 'simple' : 'main'
  try {
    return Response.json(await segmentScript(id, variant))
  } catch (e) {
    const msg = (e as Error).message
    console.error('script generation failed', id, variant, e)
    return Response.json({ error: msg }, { status: msg === 'segment not found' ? 404 : 502 })
  }
}
