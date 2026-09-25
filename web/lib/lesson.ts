// Lesson plan generator + segment script generator. Server only.
import { sql } from './db.ts'
import { generateJson, MODEL } from './llm.ts'
import { retrieveSyllabusContext, type Match } from './rag.ts'
import { fitPlan } from './period.ts'
import { timeBeats, WPM, type RawBeat, type Script } from './script.ts'

type PlanSeg = { title: string; minutes: number; key_points: string[] }
type ConceptSeg = PlanSeg & { checkpoint: { question: string; answer: string } }
type PlanOut = { title: string; summary: string; objectives: string[]; intro: PlanSeg; concepts: ConceptSeg[]; recap: PlanSeg }

const str = { type: 'string' }
const strs = { type: 'array', items: str }
const seg = { type: 'object', properties: { title: str, minutes: { type: 'number' }, key_points: strs }, required: ['title', 'minutes', 'key_points'] }
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    title: str, summary: str, objectives: strs, intro: seg, recap: seg,
    concepts: {
      type: 'array', minItems: 3, maxItems: 4,
      items: {
        ...seg,
        properties: { ...seg.properties, checkpoint: { type: 'object', properties: { question: str, answer: str }, required: ['question', 'answer'] } },
        required: [...seg.required, 'checkpoint'],
      },
    },
  },
  required: ['title', 'summary', 'objectives', 'intro', 'concepts', 'recap'],
}

const PLAN_SYSTEM = `You plan one live class taught by an AI teacher who talks while writing on a whiteboard, in front of a room of students.
Ground the plan in the syllabus excerpt and stay inside the requested topic. Pitch it at the level the syllabus implies.
Structure: intro (3-5 min), 3-4 concept segments (8-10 min each), recap (5-7 min). The whole lesson must fit the class period.
No human teacher is in the room: the board teaches alone, so the plan must be self-contained.
Each concept segment ends with one checkpoint question the class can answer aloud in under a minute, with a short model answer.
Key points are concrete teachable facts or skills (3-5 per segment), not vague themes.`

const excerpt = (ctx: Match[]) => ctx.map(c => `[page ${c.page}] ${c.content}`).join('\n\n')

export type LessonOpts = { className?: string; room?: string; scheduledAt?: Date | null; durationMin?: number }

export async function generateLessonPlan(topic: string, opts: LessonOpts = {}): Promise<string> {
  topic = topic.trim()
  if (!topic) throw new Error('topic is empty')
  const period = opts.durationMin ?? 50
  const ctx = await retrieveSyllabusContext(topic, 3)
  const plan = await generateJson<PlanOut>(PLAN_SYSTEM, `Topic: ${topic}\nClass period: ${period} minutes\n\nSyllabus excerpt:\n${excerpt(ctx)}`, PLAN_SCHEMA)
  if (plan.concepts.length < 3) throw new Error(`plan has ${plan.concepts.length} concept segments, need 3-4`)

  // The model's minutes are suggestions; the ranges and the period are the contract.
  const fit = fitPlan(plan.intro.minutes, plan.concepts.map(c => c.minutes), plan.recap.minutes, period)
  const segments = [
    { kind: 'intro', ...plan.intro, minutes: fit.intro, checkpoint: null },
    ...fit.concepts.map((m, i) => ({ kind: 'concept', ...plan.concepts[i], minutes: m })),
    { kind: 'recap', ...plan.recap, minutes: fit.recap, checkpoint: null },
  ]

  return sql.begin(async tx => {
    const [s] = await tx`
      insert into sessions (topic, class_name, room, scheduled_at, duration_min)
      values (${topic}, ${opts.className?.trim() || null}, ${opts.room || null}, ${opts.scheduledAt ?? null}, ${period})
      returning id`
    const [lp] = await tx`
      insert into lesson_plans (session_id, model, title, summary, objectives, raw)
      values (${s.id}, ${MODEL}, ${plan.title}, ${plan.summary}, ${plan.objectives}, ${tx.json(plan)})
      returning id`
    for (const [idx, g] of segments.entries())
      await tx`
        insert into segments (lesson_plan_id, idx, kind, title, target_minutes, key_points, checkpoint)
        values (${lp.id}, ${idx}, ${g.kind}, ${g.title}, ${g.minutes}, ${g.key_points},
                ${g.checkpoint ? tx.json(g.checkpoint) : null})`
    return s.id as string
  })
}

const SCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    beats: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          say: str,
          board: {
            type: 'array', maxItems: 3,
            items: { type: 'object', properties: { type: { type: 'string', enum: ['heading', 'line', 'label', 'formula'] }, text: str }, required: ['type', 'text'] },
          },
        },
        required: ['say', 'board'],
      },
    },
  },
  required: ['beats'],
}

const SCRIPT_SYSTEM = `You write the live narration for one segment of a class taught by an AI teacher at a whiteboard.
Output a list of beats. Each beat = what the teacher says (1-3 sentences, at most 60 words) plus 0-3 board actions written while saying it.
Narration: warm, spoken classroom English. No markdown, no emoji, no lists. Say symbols as words ("x equals 5").
Use examples and ask the room rhetorical questions. Build on earlier segments; don't re-introduce the lesson.
Board actions are short and must match what that beat is saying:
- heading: starts a fresh board; at most 6 words. The first beat must have a heading with the segment title. Use a new heading only when the sub-topic changes (roughly every 2-3 minutes).
- line: a key point or a line of code, at most 60 characters.
- label: a diagram label or keyword, at most 4 words.
- formula: an expression or code snippet, at most 50 characters.
Concept segments: end by telling the class a checkpoint question is coming. Do not state the question; it is shown separately.`

const SIMPLE_NOTE = `
The class did not follow this segment the first time. Re-teach the same key points more simply:
shorter sentences, everyday words, one concrete real-life analogy, one worked example done slowly.
Open by saying, kindly, that we'll look at this again another way. Fewer, larger board actions.`

export type Variant = 'main' | 'simple'

// Concurrent requests for the same segment (play + prefetch) share one generation.
const inflight = new Map<string, Promise<Script>>()

export function segmentScript(segmentId: string, variant: Variant = 'main'): Promise<Script> {
  const key = `${segmentId}:${variant}`
  let p = inflight.get(key)
  if (!p) {
    p = buildScript(segmentId, variant).finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  return p
}

async function buildScript(segmentId: string, variant: Variant): Promise<Script> {
  const col = variant === 'simple' ? 'simplified_script' : 'script'
  const [seg] = await sql`
    select s.*, lp.title as plan_title, lp.objectives
    from segments s join lesson_plans lp on lp.id = s.lesson_plan_id where s.id = ${segmentId}`
  if (!seg) throw new Error('segment not found')
  if (seg[col]) return seg[col] as Script

  const outline = await sql`select idx, kind, title from segments where lesson_plan_id = ${seg.lesson_plan_id} order by idx`
  const ctx = await retrieveSyllabusContext(`${seg.title}: ${seg.key_points.join(', ')}`, 2)
  // The simplified replay is shorter: ~60% of the original, at least 3 minutes.
  const minutes = variant === 'simple' ? Math.max(3, Number(seg.target_minutes) * 0.6) : Number(seg.target_minutes)
  const targetSeconds = Math.round(minutes * 60)
  const targetWords = Math.round(minutes * WPM)
  const said = variant === 'simple' && seg.script
    ? `\n\nWhat the teacher said the first time (don't repeat it word for word):\n${(seg.script as Script).beats.map(b => b.say).join(' ').slice(0, 4000)}`
    : ''
  const prompt = `Lesson: ${seg.plan_title}
Objectives: ${seg.objectives.join('; ')}
Full lesson outline:
${outline.map(o => `${o.idx + 1}. [${o.kind}] ${o.title}${o.idx === seg.idx ? '   <-- this segment' : ''}`).join('\n')}

This segment (${seg.kind}): ${seg.title}
Key points to teach: ${seg.key_points.join('; ')}
${seg.checkpoint ? `Checkpoint question shown after this segment: ${seg.checkpoint.question}` : ''}
Length: ${minutes.toFixed(1)} minutes at ${WPM} words per minute = about ${targetWords} words of narration in total.
${variant === 'simple' ? SIMPLE_NOTE + said : ''}
Syllabus excerpt:
${excerpt(ctx)}`

  let script!: Script
  let feedback = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await generateJson<{ beats: RawBeat[] }>(SCRIPT_SYSTEM, prompt + feedback, SCRIPT_SCHEMA)
    script = timeBeats(raw.beats.filter(b => b.say.trim()), targetSeconds)
    if (Math.abs(script.words - targetWords) / targetWords <= 0.2) break
    feedback = `\n\nYour previous draft was ${script.words} words. It must be ${targetWords} words (±10%). Rewrite it at that length.`
  }
  await sql`update segments set ${sql(col)} = ${sql.json(script)} where id = ${segmentId}`
  return script
}

const GRADE_SCHEMA = {
  type: 'object',
  properties: { grade: { type: 'string', enum: ['correct', 'partial', 'wrong'] }, feedback: str },
  required: ['grade', 'feedback'],
}

// Grade a spoken/typed checkpoint answer. `feedback` is one short sentence the teacher says aloud.
export async function gradeAnswer(question: string, modelAnswer: string, answer: string) {
  return generateJson<{ grade: 'correct' | 'partial' | 'wrong'; feedback: string }>(
    `You grade a student's answer to a quick classroom checkpoint question. Be generous with wording and
speech-to-text errors; grade the idea. "partial" = on the right track but missing something important.
feedback: one short, warm sentence the teacher says aloud to the room (no markdown).`,
    `Question: ${question}\nModel answer: ${modelAnswer}\nStudent answer: ${answer}`,
    GRADE_SCHEMA,
  )
}

// Write every segment's script ahead of class so the board never makes students wait.
// Sequential on purpose: gentle on rate limits, and segment 1 is ready first.
export async function pregenerateScripts(sessionId: string) {
  const segs = await sql`
    select g.id from segments g join lesson_plans lp on lp.id = g.lesson_plan_id
    where lp.session_id = ${sessionId} and g.script is null order by g.idx`
  for (const g of segs) await segmentScript(g.id).catch(e => console.error('pregenerate failed', g.id, e))
}
