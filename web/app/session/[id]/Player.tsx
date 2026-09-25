'use client'
import { useEffect, useRef, useState } from 'react'
import { Board } from '@/components/Board.tsx'
import { startMonitor, type Room } from '@/lib/monitor.ts'
import { canReplay, nextSegment } from '@/lib/period.ts'
import { startRecording } from '@/lib/recorder.ts'
import { placeBeat, type BoardItem, type Script } from '@/lib/script.ts'
import { loadClip, type Clip } from '@/lib/voice.ts'
import { Checkpoint, type CheckResult } from './Checkpoint.tsx'

export type Seg = {
  id: string; idx: number; kind: 'intro' | 'concept' | 'recap'; title: string; minutes: number
  checkpoint: { question: string; answer: string } | null
}
type Variant = 'main' | 'simple'
type Phase = 'idle' | 'gathering' | 'loading' | 'playing' | 'checkpoint' | 'ending' | 'done'
type Rec = 'off' | 'recording' | 'saving' | 'saved' | 'lost'
type Hold = 'user' | 'warning' | 'teacher' // anything that pauses the lesson

// Autonomous mode (the classroom smart board): waits for students, takes a headcount, teaches until the
// period ends, warns the room when it misbehaves, pauses while the teacher is on the video call.
export type Auto = { periodEnd: number; onDone?: () => void }

const GATHER_S = 10          // students must be in view this long before class starts
const NO_CAMERA_START_S = 60 // camera/vision not working: start anyway after this long

export function Player({ sessionId, title, segments, auto }: { sessionId: string; title: string; segments: Seg[]; auto?: Auto }) {
  const [segIdx, setSegIdx] = useState(0)
  const [variant, setVariant] = useState<Variant>('main')
  const [phase, setPhase] = useState<Phase>('idle')
  const [items, setItems] = useState<BoardItem[]>([])
  const [now, setNow] = useState(0)
  const [caption, setCaption] = useState('')
  const [waiting, setWaiting] = useState('')
  const [holds, setHolds] = useState<Hold[]>([])
  const [fallback, setFallback] = useState(false)
  const [error, setError] = useState('')
  const [grading, setGrading] = useState(false)
  const [listen, setListen] = useState(false)
  const [result, setResult] = useState<CheckResult | null>(null)
  const [room, setRoom] = useState<Room>({ status: 'off', persons: 0, phones: 0, signals: [] })
  const [warning, setWarning] = useState('')
  const [rec, setRec] = useState<Rec>('off')
  const [dailyUrl, setDailyUrl] = useState<string | null>(null)
  const [teacher, setTeacher] = useState(false)
  const [soundBlocked, setSoundBlocked] = useState(false)
  const [ended, setEnded] = useState<{ recording_url: string | null; email: { sent: boolean; reason?: string } } | null>(null)

  const runRef = useRef(0)            // bumping this cancels the running segment
  const clipRef = useRef<Clip | null>(null)
  const holdsRef = useRef(new Set<Hold>())
  const segStartRef = useRef(0)       // when the current segment started playing (ms)
  const scripts = useRef(new Map<string, Promise<Script>>())
  const videoRef = useRef<HTMLVideoElement>(null)
  const stopMonitor = useRef<(() => void) | null>(null)
  const stopRecording = useRef<(() => Promise<void>) | null>(null)
  const progress = useRef({ segment: 0, variant: 'main' as Variant })
  const heartbeat = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const seen = useRef<{ at: number; persons: number }[]>([]) // per-frame headcounts while gathering

  const minutes = segments.map(s => s.minutes)
  const last = segments.length - 1
  // Time budget against the fixed end of the period (a late start just means less time):
  // treat "now" as t=0 and the bell as the period's end.
  const budget = () => ({ elapsedS: 0, periodS: (auto!.periodEnd - Date.now()) / 1000 })

  // Tell the dashboard where the class is. Re-sent every 30 s as a heartbeat, so a closed tab stops looking live.
  const report = () => fetch(`/api/sessions/${sessionId}/progress`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(progress.current),
  }).catch(() => {})

  const getScript = (id: string, v: Variant = 'main') => {
    const key = `${id}:${v}`
    let p = scripts.current.get(key)
    if (!p) {
      p = fetch(`/api/segments/${id}/script${v === 'simple' ? '?variant=simple' : ''}`, { method: 'POST' }).then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `script ${r.status}`)
        return r.json()
      })
      p.catch(() => scripts.current.delete(key)) // let a retry regenerate
      scripts.current.set(key, p)
    }
    return p
  }

  // Pause/resume the lesson. Several things can hold it at once (a warning while the teacher is on the call).
  const hold = (h: Hold, on: boolean) => {
    const was = holdsRef.current.size > 0
    if (on) holdsRef.current.add(h); else holdsRef.current.delete(h)
    const is = holdsRef.current.size > 0
    setHolds([...holdsRef.current])
    if (is && !was) clipRef.current?.pause()
    if (!is && was) clipRef.current?.resume()
  }
  const whileHeld = async (alive: () => boolean) => { while (holdsRef.current.size && alive()) await new Promise(r => setTimeout(r, 150)) }

  // Say one line (feedback, checkpoint question) outside the board timeline.
  const say = async (text: string, alive: () => boolean) => {
    if (!text) return
    const c = await loadClip(text)
    await whileHeld(alive)
    if (!alive()) return
    clipRef.current = c
    await c.play()
  }

  // The board speaks a discipline warning over the lesson: pause, warn, resume.
  const warnRoom = async (texts: string[]) => {
    hold('warning', true)
    setWarning(texts.join(' '))
    for (const t of texts) { const c = await loadClip(t); await c.play() }
    setTimeout(() => setWarning(''), 8000)
    hold('warning', false)
  }

  function watchRoom() {
    startMonitor(sessionId, videoRef.current!, patch => {
      setRoom(r => ({ ...r, ...patch }))
      if (patch.persons !== undefined) seen.current.push({ at: Date.now(), persons: patch.persons })
    }, w => warnRoom(w.map(x => x.text)))
      .then(stop => { stopMonitor.current = stop })
      .catch(e => { console.warn('room camera not started:', e); setRoom(r => ({ ...r, status: 'error' })) })
  }

  async function start(attendance: number | null = null) {
    setPhase('loading')
    // The share picker needs a user gesture; on a kiosk, launch Chrome with the flags in scripts/kiosk.sh.
    const recording = startRecording(sessionId, () => setRec('lost'))
      .then(stop => { stopRecording.current = stop; setRec('recording') })
      .catch(e => { console.warn('recording not started:', e); setRec('off') })
    if (!stopMonitor.current) watchRoom()
    const started = fetch(`/api/sessions/${sessionId}/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ attendance }),
    }).then(r => r.json()).then(s => setDailyUrl(s.daily_room_url ?? null)).catch(() => {})
    await Promise.all([recording, started])
    heartbeat.current = setInterval(report, 30_000)
    advance(0)
  }

  // Autonomous: when the board mounts, watch the room until students are in view, count them, begin.
  useEffect(() => {
    if (!auto) return
    setPhase('gathering')
    watchRoom()
    const t0 = Date.now()
    const tick = setInterval(() => {
      const recent = seen.current.filter(s => s.at > Date.now() - GATHER_S * 1000)
      const covered = seen.current.some(s => s.at <= Date.now() - GATHER_S * 1000 + 1000)
      const present = covered && recent.length > 0 && recent.every(s => s.persons > 0)
      const noCamera = !seen.current.length && Date.now() - t0 > NO_CAMERA_START_S * 1000
      if (present || noCamera) {
        clearInterval(tick)
        start(present ? Math.max(...recent.map(s => s.persons)) : null) // headcount: most people seen at once
      }
    }, 1000)
    return () => clearInterval(tick)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Teacher joins/leaves the video call from the dashboard: pause the lesson and put the call on the board.
  useEffect(() => {
    const es = new EventSource(`/api/sessions/${sessionId}/events`)
    es.onmessage = e => {
      const m = JSON.parse(e.data)
      if (m.daily_room_url) setDailyUrl(m.daily_room_url)
      setTeacher(!!m.teacher_present)
      hold('teacher', !!m.teacher_present)
    }
    const blocked = () => setSoundBlocked(true), unblocked = () => setSoundBlocked(false)
    window.addEventListener('board:sound-blocked', blocked)
    window.addEventListener('board:sound-unlocked', unblocked)
    return () => { es.close(); window.removeEventListener('board:sound-blocked', blocked); window.removeEventListener('board:sound-unlocked', unblocked) }
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function finish() {
    runRef.current++
    clipRef.current?.stop()
    clearInterval(heartbeat.current)
    setPhase('ending'); setCaption(''); setListen(false)
    stopMonitor.current?.()
    if (stopRecording.current) { setRec('saving'); await stopRecording.current(); stopRecording.current = null }
    const r = await fetch(`/api/sessions/${sessionId}/end`, { method: 'POST' }).then(r => r.json()).catch(() => null)
    setEnded(r)
    setRec(rec => (r?.recording_url && rec !== 'lost' ? 'saved' : rec))
    setPhase('done')
    if (auto?.onDone) setTimeout(auto.onDone, 60_000) // leave "class complete" up for a minute, then wait for the next class
  }

  // Go to segment i, or wherever the period's time budget allows (recap is protected; the bell ends class).
  function advance(i: number) {
    if (!auto) return i < segments.length ? runSegment(i) : finish()
    const { elapsedS, periodS } = budget()
    const n = nextSegment(i, minutes, elapsedS, periodS)
    return n === 'end' ? finish() : runSegment(n)
  }

  async function runSegment(i: number, v: Variant = 'main') {
    const run = ++runRef.current
    const alive = () => run === runRef.current
    clipRef.current?.stop()
    setSegIdx(i); setVariant(v); setItems([]); setNow(0); setCaption(''); setError('')
    setResult(null); setGrading(false); setListen(false)
    setPhase('loading')
    progress.current = { segment: i, variant: v }
    report()
    const seg = segments[i]
    try {
      setWaiting(v === 'simple' ? 'Writing a simpler explanation…' : 'Writing the script for this segment…')
      const script = await getScript(seg.id, v)
      if (!alive()) return
      if (segments[i + 1]) getScript(segments[i + 1].id).catch(() => {}) // prefetch next segment's script

      // Synthesize up to 2 beats ahead of the one playing.
      const clips: Promise<Clip>[] = []
      const clip = (b: number) => b < script.beats.length ? (clips[b] ??= loadClip(script.beats[b].say)) : undefined
      setPhase('playing')
      segStartRef.current = Date.now()
      let clock = 0
      for (let b = 0; b < script.beats.length; b++) {
        if (auto) { // running long: the bell or the recap takes priority over finishing this segment
          if (Date.now() > auto.periodEnd + 60_000) return finish()
          if (i < last && Date.now() + minutes[last] * 60_000 > auto.periodEnd) return runSegment(last)
        }
        setWaiting('Synthesizing voice…')
        const c = await clip(b)!
        clip(b + 1); clip(b + 2)
        setWaiting('')
        await whileHeld(alive)
        if (!alive()) return c.stop()

        const start = clock
        setFallback(c.fallback)
        setCaption(script.beats[b].say)
        setItems(prev => [...prev, ...placeBeat(script.beats[b], b, start, c.duration)])
        clipRef.current = c
        let raf = 0
        const tick = () => { setNow(start + c.time()); raf = requestAnimationFrame(tick) }
        tick()
        await c.play()
        cancelAnimationFrame(raf)
        if (!alive()) return
        clock += c.duration
        setNow(clock)
      }
      setCaption('')

      if (seg.checkpoint) {
        setPhase('checkpoint')
        // ponytail: always pre-writes the simpler variant while the class answers (one extra LLM call per concept);
        // make it conditional on the room if cost matters.
        if (v === 'main') getScript(seg.id, 'simple').catch(() => {})
        await say(`Checkpoint question. ${seg.checkpoint.question}${auto ? ' Say your answer out loud.' : ''}`, alive)
        if (alive()) setListen(true)
      } else {
        advance(i + 1)
      }
    } catch (e) {
      if (alive()) {
        setError(String((e as Error).message)); setWaiting('')
        if (auto) setTimeout(() => alive() && advance(i + 1), 5000) // nobody to press retry: skip ahead
      }
    }
  }

  async function submitAnswer(answer: string) {
    const run = runRef.current
    const alive = () => run === runRef.current
    const i = segIdx, retry = variant === 'simple'
    clipRef.current?.stop()
    setGrading(true); setListen(false)
    const r: CheckResult | null = await fetch(`/api/segments/${segments[i].id}/checkpoint`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, answer, attempt: retry ? 1 : 0, window_s: (Date.now() - segStartRef.current) / 1000 }),
    }).then(r => (r.ok ? r.json() : null)).catch(() => null)
    if (!alive()) return
    // If grading fails, don't strand the class: move on. Out of time: no replay either.
    const res: CheckResult = r ?? { decision: 'next', grade: null, feedback: null, signals: [] }
    if (auto && res.decision === 'replay') {
      const { elapsedS, periodS } = budget()
      if (!canReplay(i, minutes, Math.max(3, minutes[i] * 0.6), elapsedS, periodS)) res.decision = 'next'
    }
    setGrading(false); setResult(res)
    const line = res.feedback ?? (res.decision === 'replay' ? '' : 'Okay, let’s keep going.')
    await say(res.decision === 'replay' ? `${line} Let's look at that again, a little differently.` : line, alive)
    if (!alive()) return
    if (res.decision === 'replay') runSegment(i, 'simple')
    else advance(i + 1)
  }

  const seg = segments[segIdx]
  const skip = () => advance(segIdx + 1)
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  const live = phase !== 'idle' && phase !== 'gathering' && phase !== 'ending' && phase !== 'done'
  const userPaused = holds.includes('user')

  return (
    <div className="grid min-h-screen grid-cols-[1fr_300px] gap-6 bg-neutral-900 p-6 text-neutral-100">
      <main className="flex flex-col gap-4">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold">{title}</h1>
          <span className="text-sm text-neutral-400">
            {rec === 'recording' && <span className="mr-2 text-red-400">● REC</span>}
            Segment {segIdx + 1}/{segments.length}{variant === 'simple' && ' (simpler replay)'} · {fmt(now)} / ~{fmt(seg.minutes * 60)}
            {auto && live && <> · bell in {fmt(Math.max(0, (auto.periodEnd - Date.now()) / 1000))}</>}
            {fallback && <span className="ml-2 text-amber-400">browser voice (OmniVoice offline)</span>}
          </span>
        </header>

        <div className="relative">
          <Board items={items} now={now} className="h-[62vh] overflow-hidden" />
          {phase === 'idle' && (
            <button onClick={() => start()} className="absolute inset-0 m-auto h-16 w-56 rounded-full bg-[#f7d774] text-xl font-semibold text-neutral-900">
              ▶ Start class
            </button>
          )}
          {phase === 'gathering' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
              <p className="font-hand text-6xl text-[#f7d774]">Welcome! Please take your seats.</p>
              <p className="text-xl text-neutral-300">{title} starts when everyone is here.</p>
              <p className="text-neutral-400">{room.status === 'live' ? `👥 ${room.persons} in the room` : 'Looking for the class…'}</p>
            </div>
          )}
          {phase === 'checkpoint' && seg.checkpoint && (
            <Checkpoint key={`${seg.id}:${variant}`} question={seg.checkpoint.question} answer={seg.checkpoint.answer}
              retry={variant === 'simple'} grading={grading} result={result} onSubmit={submitAnswer}
              seconds={auto ? 45 : 60} autoListen={!!auto && listen} paused={holds.length > 0} />
          )}
          {warning && (
            <div className="absolute inset-x-8 top-8 rounded-xl border-2 border-amber-400 bg-amber-950/95 p-5 text-2xl text-amber-100 shadow-2xl" role="alert">
              ⚠ {warning}
            </div>
          )}
          {teacher && (
            <div className="absolute inset-0 flex flex-col gap-3 rounded-2xl bg-neutral-950/95 p-6">
              <p className="text-xl text-[#f7d774]">Your teacher has joined the class</p>
              {dailyUrl
                ? <iframe src={dailyUrl} title="Teacher video call" allow="camera; microphone; autoplay; display-capture; fullscreen" className="w-full flex-1 rounded-lg bg-black" />
                : <p className="text-neutral-400">Connecting the video call…</p>}
            </div>
          )}
          {soundBlocked && (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/70 text-3xl text-white">👆 Tap anywhere to turn on the sound</div>
          )}
          {(phase === 'ending' || phase === 'done') && (
            <div className="absolute inset-0 m-auto h-fit w-fit max-w-lg rounded-xl bg-white px-8 py-6 text-neutral-900">
              <p className="text-2xl">{phase === 'ending' ? 'Saving the recording…' : 'Class complete 🎓'}</p>
              {!auto && ended?.recording_url && <a href={ended.recording_url} target="_blank" className="mt-2 block text-emerald-700 underline">Watch the recording</a>}
              {!auto && ended && <p className="mt-1 text-sm text-neutral-500">{ended.email.sent ? 'Recording link emailed.' : `Email not sent: ${ended.email.reason}`}</p>}
              {rec === 'lost' && <p className="mt-1 text-sm text-red-600">Some recording chunks failed to upload.</p>}
            </div>
          )}
        </div>

        <p className="min-h-[3.5rem] text-lg text-neutral-300">{caption}</p>
        <div className="flex items-center gap-3 text-sm">
          {!auto && (phase === 'playing' || phase === 'loading') && (
            <button onClick={() => hold('user', !userPaused)} className="rounded-lg bg-neutral-700 px-4 py-2">{userPaused ? '▶ Resume' : '⏸ Pause'}</button>
          )}
          {!auto && live && <button onClick={skip} className="rounded-lg bg-neutral-800 px-4 py-2">Skip segment ⏭</button>}
          {!auto && live && <button onClick={finish} className="rounded-lg bg-neutral-800 px-4 py-2">End class ⏹</button>}
          {waiting && <span className="animate-pulse text-neutral-400">{waiting}</span>}
          {error && (
            <span className="text-red-400">
              {error} {!auto && <button onClick={() => runSegment(segIdx, variant)} className="underline">retry</button>}
            </span>
          )}
        </div>
      </main>

      <aside className="flex flex-col gap-2">
        <div className="relative overflow-hidden rounded-lg bg-black">
          <video ref={videoRef} muted playsInline className="aspect-video w-full object-cover" />
          <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs">
            {room.status === 'live' ? `👥 ${room.persons} · 📱 ${room.phones}` : `camera: ${room.status}`}
          </span>
        </div>
        {room.signals.length > 0 && (
          <p className="rounded-lg bg-amber-900/60 px-3 py-2 text-sm text-amber-200">⚠ {room.signals.join(', ').replaceAll('_', ' ')}</p>
        )}
        <h2 className="mt-2 text-sm uppercase tracking-wide text-neutral-400">Lesson plan</h2>
        {segments.map((s, i) => (
          <button key={s.id} onClick={() => runSegment(i)} disabled={!live || !!auto}
            className={`rounded-lg px-3 py-2 text-left ${i === segIdx && live ? 'bg-emerald-800' : 'bg-neutral-800 enabled:hover:bg-neutral-700'}`}>
            <span className="text-xs uppercase text-neutral-400">{s.kind} · {s.minutes} min</span>
            <span className="block">{s.title}</span>
          </button>
        ))}
      </aside>
    </div>
  )
}
