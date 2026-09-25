// Server side: read a session's room-camera samples and evaluate them.
import { sql } from './db.ts'
import { signals, type Sample } from './engagement.ts'

export async function roomSamples(sessionId: string, lastSeconds: number) {
  const since = new Date(Date.now() - lastSeconds * 1000)
  const rows = await sql`
    select extract(epoch from at) * 1000 as at, persons, phones from engagement_samples
    where session_id = ${sessionId} and at >= ${since} order by at`
  // The class's usual size: 80th percentile of headcount over the whole session.
  const [{ baseline }] = await sql`
    select coalesce(percentile_cont(0.8) within group (order by persons), 0) as baseline
    from engagement_samples where session_id = ${sessionId}`
  const samples: Sample[] = rows.map(r => ({ at: Number(r.at), persons: r.persons, phones: r.phones }))
  return { samples, baseline: Number(baseline) }
}

export async function roomSignals(sessionId: string, lastSeconds: number) {
  const { samples, baseline } = await roomSamples(sessionId, lastSeconds)
  return signals(samples, baseline)
}
