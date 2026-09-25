// Client side: stream room-camera frames to the vision service and report 5 s summaries to the server.
import type { Signal } from './engagement.ts'

export type Room = { status: 'off' | 'connecting' | 'live' | 'error'; persons: number; phones: number; signals: Signal[] }

const VISION_WS = process.env.NEXT_PUBLIC_VISION_WS ?? 'ws://127.0.0.1:8002/ws'
const FRAME_MS = 500 // ≤ 2 fps; a new frame is only sent once the previous one is answered

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]

export async function startMonitor(
  sessionId: string, video: HTMLVideoElement, update: (r: Partial<Room>) => void,
  onWarn: (w: { type: Signal; text: string }[]) => void = () => {},
) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
  video.srcObject = stream
  await video.play()

  const canvas = document.createElement('canvas')
  let ws: WebSocket | undefined
  let stopped = false
  let sentAt = 0 // when the in-flight frame was sent; 0 = nothing in flight
  let persons: number[] = [], phones: number[] = []

  const connect = () => {
    update({ status: 'connecting' })
    ws = new WebSocket(VISION_WS)
    ws.onopen = () => update({ status: 'live' })
    ws.onmessage = e => {
      sentAt = 0
      const r = JSON.parse(e.data)
      if (r.error) return console.warn('vision:', r.error)
      persons.push(r.persons); phones.push(r.phones)
      update({ persons: r.persons, phones: r.phones })
    }
    ws.onclose = () => {
      sentAt = 0
      if (!stopped) { update({ status: 'error' }); setTimeout(connect, 3000) }
    }
  }
  connect()

  const grab = setInterval(() => {
    if (ws?.readyState !== WebSocket.OPEN || !video.videoWidth) return
    if (sentAt && Date.now() - sentAt < 5000) return // still waiting on the last frame (give up after 5 s)
    canvas.width = 640
    canvas.height = Math.round((video.videoHeight * 640) / video.videoWidth)
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
    sentAt = Date.now()
    canvas.toBlob(b => (b ? b.arrayBuffer().then(buf => ws?.send(buf)) : (sentAt = 0)), 'image/jpeg', 0.7)
  }, FRAME_MS)

  const report = setInterval(async () => {
    if (!persons.length) return
    const body = { persons: median(persons), phones: Math.max(...phones), frames: persons.length }
    persons = []; phones = []
    const r = await fetch(`/api/sessions/${sessionId}/engagement`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }).then(r => r.json()).catch(() => null)
    if (r?.signals) update({ signals: r.signals })
    if (r?.warn?.length) onWarn(r.warn)
  }, 5000)

  return () => {
    stopped = true
    clearInterval(grab); clearInterval(report)
    ws?.close()
    stream.getTracks().forEach(t => t.stop())
    update({ status: 'off' })
  }
}
