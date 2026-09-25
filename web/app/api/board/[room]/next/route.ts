import { isRoom, nextSessionForRoom } from '@/lib/board.ts'

export const dynamic = 'force-dynamic'

// The smart board polls this while idle to find the class it should run.
export async function GET(_: Request, { params }: { params: Promise<{ room: string }> }) {
  const { room } = await params
  if (!isRoom(room)) return Response.json({ error: 'bad room name' }, { status: 400 })
  return Response.json(await nextSessionForRoom(room))
}
