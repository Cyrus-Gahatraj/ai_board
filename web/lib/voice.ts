// Client side: turn a line of narration into a playable clip with a known duration.
import { WPM, wordCount } from './script.ts'

export type Clip = {
  duration: number   // seconds
  time: () => number // seconds played so far; drives the board clock
  play: () => Promise<void> // resolves when finished or stopped
  pause: () => void
  resume: () => void
  stop: () => void
  fallback: boolean  // true = browser speechSynthesis, OmniVoice was unreachable
}

export async function loadClip(text: string): Promise<Clip> {
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) throw new Error(`tts ${res.status}: ${await res.text()}`)
    const url = URL.createObjectURL(await res.blob())
    const audio = new Audio(url)
    await new Promise((ok, fail) => { audio.onloadedmetadata = ok; audio.onerror = fail })
    let finish = () => {}
    return {
      duration: audio.duration,
      fallback: false,
      time: () => audio.currentTime,
      play: () => new Promise<void>(done => {
        finish = () => { URL.revokeObjectURL(url); done() }
        audio.onended = finish
        audio.play().catch(async (e: Error) => {
          if (e.name !== 'NotAllowedError') return finish()
          await soundUnlocked() // browser blocked autoplay: wait for one tap, then carry on
          audio.play().catch(finish)
        })
      }),
      pause: () => audio.pause(),
      resume: () => void audio.play(),
      stop: () => { audio.pause(); finish() },
    }
  } catch (e) {
    console.warn('OmniVoice unavailable, falling back to browser speech:', e)
    return browserClip(text)
  }
}

// ponytail: duration is estimated at WPM, so board sync is approximate in fallback mode.
function browserClip(text: string): Clip {
  const duration = (wordCount(text) / WPM) * 60
  let startedAt = 0, pausedAt = 0, paused = false
  const time = () => Math.min(duration, paused ? pausedAt : (performance.now() - startedAt) / 1000)
  const u = new SpeechSynthesisUtterance(text)
  return {
    duration,
    fallback: true,
    time,
    play: () => new Promise<void>(done => {
      u.onend = u.onerror = () => done()
      startedAt = performance.now()
      speechSynthesis.speak(u)
      // Chrome sometimes never fires `end` (long utterances, no voices installed): don't let the lesson hang.
      const guard = () => (!paused && (performance.now() - startedAt) / 1000 > duration * 1.5 + 1 ? done() : setTimeout(guard, 500))
      guard()
    }),
    pause: () => { pausedAt = time(); paused = true; speechSynthesis.pause() },
    resume: () => { startedAt = performance.now() - pausedAt * 1000; paused = false; speechSynthesis.resume() },
    stop: () => speechSynthesis.cancel(),
  }
}

// Chrome blocks sound until someone interacts with the page (unless the kiosk is launched with
// --autoplay-policy=no-user-gesture-required). Show a "tap to start" prompt and wait for that tap.
let unlock: Promise<void> | null = null
export function soundUnlocked() {
  unlock ??= new Promise<void>(resolve => {
    window.dispatchEvent(new Event('board:sound-blocked'))
    const off = new AbortController()
    const go = () => { off.abort(); unlock = null; window.dispatchEvent(new Event('board:sound-unlocked')); resolve() }
    window.addEventListener('pointerdown', go, { signal: off.signal })
    window.addEventListener('keydown', go, { signal: off.signal })
  })
  return unlock
}
