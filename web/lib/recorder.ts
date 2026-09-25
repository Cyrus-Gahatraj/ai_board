// Client side: record this tab (the board + narration audio) and upload it in 5 s chunks as the class runs.
// Chrome shows a share picker: choose "This tab" and keep "Share tab audio" on.

export async function startRecording(sessionId: string, onLost: () => void) {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 15 },
    audio: true,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
  } as DisplayMediaStreamOptions)
  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t))
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 800_000 }) // ~300 MB per 50 min

  let seq = 0
  let queue = Promise.resolve() // uploads run strictly in order
  rec.ondataavailable = e => {
    if (!e.data.size) return
    const n = seq++, blob = e.data
    queue = queue.then(() => upload(sessionId, n, blob, onLost))
  }
  const stopped = new Promise<void>(r => (rec.onstop = () => r())) // also fires if the user clicks "Stop sharing"
  rec.start(5000)

  return async function stop() {
    if (rec.state !== 'inactive') rec.stop()
    await stopped
    await queue
    stream.getTracks().forEach(t => t.stop())
  }
}

async function upload(sessionId: string, seq: number, blob: Blob, onLost: () => void) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`/api/sessions/${sessionId}/recording?seq=${seq}`, { method: 'POST', body: blob }).catch(() => null)
    if (r?.ok) return
    await new Promise(res => setTimeout(res, 1000 * (attempt + 1)))
  }
  console.error('recording chunk lost', seq)
  onLost()
}
