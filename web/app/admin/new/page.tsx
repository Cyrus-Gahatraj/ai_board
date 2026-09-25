import { after } from 'next/server'
import { redirect } from 'next/navigation'
import { generateLessonPlan, pregenerateScripts } from '@/lib/lesson.ts'
import { isRoom } from '@/lib/board.ts'

async function createLesson(form: FormData) {
  'use server'
  const room = String(form.get('room') ?? '').trim().toLowerCase()
  const when = String(form.get('scheduled_at') ?? '')
  const duration = Number(form.get('duration_min'))
  if (!isRoom(room)) throw new Error('Room must be lowercase letters, digits and dashes, e.g. room-101')
  // ponytail: datetime-local has no zone; it's read in the server's zone, fine while server and boards share one.
  const scheduledAt = new Date(when)
  if (Number.isNaN(+scheduledAt)) throw new Error('Pick a start time')
  if (!Number.isInteger(duration) || duration < 15 || duration > 120) throw new Error('Period must be 15-120 minutes')

  const id = await generateLessonPlan(String(form.get('topic') ?? ''), {
    className: String(form.get('class_name') ?? '').slice(0, 100), room, scheduledAt, durationMin: duration,
  })
  after(() => pregenerateScripts(id)) // write every segment's script now, so the board never waits in class
  redirect(`/admin/sessions/${id}`)
}

const input = 'rounded-lg bg-neutral-800 px-4 py-3 outline-none ring-emerald-600 focus:ring-2'
const label = 'text-sm text-neutral-400'

export default function NewLesson() {
  return (
    <form action={createLesson} className="mx-auto flex max-w-xl flex-col gap-3">
      <h1 className="text-xl font-semibold">Plan a lesson</h1>
      <p className="text-sm text-neutral-400">The board in that room starts the class on its own when students arrive, and teaches until the period ends.</p>
      <label htmlFor="topic" className={label}>Syllabus topic</label>
      <input id="topic" name="topic" required maxLength={300} placeholder="e.g. Unit II — Decision Making and Iteration" className={input} />
      <label htmlFor="class_name" className={label}>Class</label>
      <input id="class_name" name="class_name" maxLength={100} placeholder="e.g. CAP1002 · Section A" className={input} />
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="room" className={label}>Room (board)</label>
          <input id="room" name="room" required pattern="[a-z0-9][a-z0-9\-]{0,39}" placeholder="room-101" className={input} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="scheduled_at" className={label}>Starts</label>
          <input id="scheduled_at" name="scheduled_at" type="datetime-local" required className={input} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="duration_min" className={label}>Period (min)</label>
          <input id="duration_min" name="duration_min" type="number" min={15} max={120} defaultValue={50} required className={input} />
        </div>
      </div>
      <button className="mt-2 rounded-lg bg-emerald-700 px-4 py-3 font-semibold">Generate lesson plan (~20 s)</button>
    </form>
  )
}
