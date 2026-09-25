// Resend via its HTTP API (no SDK). With the shared test sender, Resend only delivers to your own account email.
export async function sendRecordingEmail(lessonTitle: string, url: string): Promise<{ sent: boolean; reason?: string }> {
  const key = process.env.RESEND_API_KEY
  const to = process.env.RECORDING_EMAIL_TO
  if (!key || !to) return { sent: false, reason: 'RESEND_API_KEY or RECORDING_EMAIL_TO not set' }
  const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env.RESEND_FROM ?? 'AI Board <onboarding@resend.dev>',
      to: to.split(',').map(s => s.trim()),
      subject: `Class recording: ${lessonTitle}`,
      html: `<p>The recording of <b>${esc(lessonTitle)}</b> is ready.</p><p><a href="${esc(url)}">Watch the recording</a></p>`,
    }),
  }).catch((e: Error) => e)
  if (res instanceof Error) return { sent: false, reason: res.message }
  return res.ok ? { sent: true } : { sent: false, reason: `resend ${res.status}: ${await res.text()}` }
}
