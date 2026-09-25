import { notFound } from 'next/navigation'
import { sessionSegments } from '@/lib/admin.ts'
import { isRoom, nextSessionForRoom } from '@/lib/board.ts'
import type { Seg } from '../../session/[id]/Player.tsx'
import { BoardRunner } from './BoardRunner.tsx'

export const dynamic = 'force-dynamic'

// The smart board's kiosk URL, e.g. /board/room-101. Idle until a class is due, then runs it by itself.
export default async function BoardPage({ params }: { params: Promise<{ room: string }> }) {
  const { room } = await params
  if (!isRoom(room)) notFound()
  const next = await nextSessionForRoom(room)
  const due = next && +next.scheduled_at <= Date.now()
  const segments = due ? ((await sessionSegments(next.id)) as unknown as Seg[]) : null
  return (
    <BoardRunner room={room} segments={segments ? [...segments] : null}
      next={next && { id: next.id, title: next.title, class_name: next.class_name, scheduled_at: next.scheduled_at.toISOString(), duration_min: next.duration_min }} />
  )
}
