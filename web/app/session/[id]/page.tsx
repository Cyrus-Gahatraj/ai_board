import { notFound } from 'next/navigation'
import { isUuid, sql } from '@/lib/db.ts'
import { Player, type Seg } from './Player.tsx'


export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const [plan] = await sql`select id, title from lesson_plans where session_id = ${id}`
  if (!plan) notFound()
  const segments = await sql<Seg[]>`
    select id, idx, kind, title, target_minutes::float as minutes, checkpoint
    from segments where lesson_plan_id = ${plan.id} order by idx`
  return <Player sessionId={id} title={plan.title} segments={[...segments]} />
}
