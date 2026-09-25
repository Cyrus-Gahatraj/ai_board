// Proxies narration to the OmniVoice service (services/voice) and streams the WAV back.
const VOICE_URL = process.env.VOICE_URL ?? 'http://127.0.0.1:8001'

export async function POST(req: Request) {
  const { text, voice_config } = await req.json().catch(() => ({}))
  if (typeof text !== 'string' || !text.trim() || text.length > 600)
    return Response.json({ error: 'text must be 1-600 characters' }, { status: 422 })

  const res = await fetch(`${VOICE_URL}/tts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-service-key': process.env.SERVICE_KEY ?? '' },
    body: JSON.stringify(voice_config && typeof voice_config === 'object' ? { text, voice_config } : { text }),
    signal: AbortSignal.timeout(30_000), // slower than this and the lesson stalls; client falls back to browser speech
  }).catch((e: Error) => e)

  if (res instanceof Error) return Response.json({ error: `voice service unreachable: ${res.message}` }, { status: 502 })
  if (!res.ok) return Response.json({ error: `voice service ${res.status}: ${await res.text()}` }, { status: 502 })
  return new Response(res.body, {
    headers: { 'content-type': 'audio/wav', 'x-duration-ms': res.headers.get('x-duration-ms') ?? '' },
  })
}
