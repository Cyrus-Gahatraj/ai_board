// Daily.co prebuilt rooms via the REST API (no SDK). One room per session, created at class start.
// ponytail: public room with an unguessable name that expires in 4 h; add meeting tokens if links may leak.
export async function createDailyRoom(): Promise<{ url?: string; reason?: string }> {
  const key = process.env.DAILY_API_KEY
  if (!key) return { reason: 'DAILY_API_KEY not set' }
  const res = await fetch('https://api.daily.co/v1/rooms', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ privacy: 'public', properties: { exp: Math.floor(Date.now() / 1000) + 4 * 3600, enable_prejoin_ui: false } }),
    signal: AbortSignal.timeout(10_000),
  }).catch((e: Error) => e)
  if (res instanceof Error) return { reason: res.message }
  if (!res.ok) return { reason: `daily ${res.status}: ${await res.text()}` }
  return { url: (await res.json()).url }
}
