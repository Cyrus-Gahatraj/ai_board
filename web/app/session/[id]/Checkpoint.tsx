'use client'
import { useEffect, useRef, useState } from 'react'

export type CheckResult = {
  decision: 'next' | 'replay'; grade: 'correct' | 'partial' | 'wrong' | null; feedback: string | null; signals: string[]
}

// Chrome's built-in speech recognition (no key, needs internet). Hold the mic button to talk.
type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void }
const SpeechRecognition = () =>
  typeof window === 'undefined' ? undefined
    : ((window as unknown as Record<string, new () => Recognition>).SpeechRecognition ?? (window as unknown as Record<string, new () => Recognition>).webkitSpeechRecognition)

const SILENCE_MS = 3500 // board mode: once the room has said something and gone quiet this long, submit it

// `seconds`: no answer by then = submit empty and let the room's engagement decide.
// `autoListen` (board mode): the mic is open the whole time; students just answer out loud.
// `paused`: a warning or the teacher's call is holding the lesson; freeze the countdown and the mic.
export function Checkpoint({ question, answer: modelAnswer, retry, grading, result, onSubmit, seconds = 60, autoListen = false, paused = false }: {
  question: string; answer: string; retry: boolean; grading: boolean; result: CheckResult | null
  onSubmit: (answer: string) => void; seconds?: number; autoListen?: boolean; paused?: boolean
}) {
  const [answer, setAnswer] = useState('')
  const [left, setLeft] = useState(seconds)
  const [listening, setListening] = useState(false)
  const rec = useRef<Recognition | null>(null)
  const done = grading || !!result

  useEffect(() => {
    if (done || paused) return
    if (left <= 0) return onSubmit(answer)
    const t = setTimeout(() => setLeft(l => l - 1), 1000)
    return () => clearTimeout(t)
  }, [left, done, paused]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const SR = SpeechRecognition()
    if (!autoListen || done || paused || !SR) return
    let stopped = false, heard = '', lastAt = 0
    const r = new SR()
    r.lang = 'en-US'; r.interimResults = true; r.continuous = true
    r.onresult = e => { heard = Array.from(e.results, x => x[0].transcript).join(' '); setAnswer(heard); lastAt = Date.now() }
    r.onend = () => { if (!stopped) try { r.start() } catch { /* already restarting */ } } // Chrome stops after silence
    r.start(); setListening(true)
    const quiet = setInterval(() => {
      if (heard.trim() && Date.now() - lastAt > SILENCE_MS) { stopped = true; r.stop(); onSubmit(heard) }
    }, 500)
    return () => { stopped = true; clearInterval(quiet); r.stop(); setListening(false) }
  }, [autoListen, done, paused]) // eslint-disable-line react-hooks/exhaustive-deps

  const startMic = () => {
    const SR = SpeechRecognition()
    if (!SR || listening) return
    const r = new SR()
    r.lang = 'en-US'; r.interimResults = true; r.continuous = true
    r.onresult = e => setAnswer(Array.from(e.results, x => x[0].transcript).join(' '))
    r.onend = () => setListening(false)
    r.start(); rec.current = r; setListening(true)
  }

  return (
    <div className="absolute inset-x-8 bottom-8 rounded-xl bg-white p-6 text-neutral-900 shadow-2xl">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
        Checkpoint{retry && ' · second try'} {!done && <span className="float-right font-normal text-neutral-500">{left}s</span>}
      </p>
      <p className="mt-1 text-2xl">{question}</p>

      {!result && (
        <form className="mt-4 flex gap-2" onSubmit={e => { e.preventDefault(); onSubmit(answer) }}>
          <input value={answer} onChange={e => setAnswer(e.target.value)} disabled={done} maxLength={1000}
            placeholder={autoListen ? (listening ? 'Listening… say your answer out loud' : 'Say your answer out loud') : "Type the class's answer, or hold the mic"} aria-label="Answer"
            className="flex-1 rounded-lg border px-3 py-2" />
          {SpeechRecognition() && (
            <button type="button" disabled={done} aria-label="Hold to speak"
              onPointerDown={startMic} onPointerUp={() => rec.current?.stop()} onPointerLeave={() => rec.current?.stop()}
              className={`rounded-lg px-4 py-2 ${listening ? 'bg-red-600 text-white' : 'border'}`}>🎤</button>
          )}
          <button disabled={done} className="rounded-lg bg-emerald-700 px-4 py-2 text-white disabled:opacity-50">
            {grading ? 'Checking…' : answer.trim() ? 'Submit' : 'No answer'}
          </button>
        </form>
      )}

      {result && (
        <div className="mt-3 space-y-1">
          {result.grade && <p className="font-semibold capitalize">{result.grade}{result.feedback && ` · ${result.feedback}`}</p>}
          <p className="text-neutral-600">Model answer: {modelAnswer}</p>
          {result.signals.length > 0 && <p className="text-amber-700">Room: {result.signals.join(', ').replaceAll('_', ' ')}</p>}
          <p className="text-emerald-800">{result.decision === 'replay' ? 'Replaying a simpler version…' : 'Moving on…'}</p>
        </div>
      )}
    </div>
  )
}
