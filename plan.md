# [Board Name] — AI Teacher Smart Whiteboard: plan.md

## Context
Hackathon demo: an AI whiteboard runs a full 50-minute class. It teaches from a syllabus PDF, writes on a virtual board while narrating, watches the room through one webcam for engagement, records the class, and lets an admin join any live class by video and get alerts. The repo is empty apart from `syllabus/document.pdf` (the prompt said `/content/syllabus/`, but the file lives at `syllabus/`, and we'll use that path as-is).

Decisions locked in with the user:
- **One room camera, many kids.** Engagement is measured for the whole room, not per student.
- **Spoken questions** go through the browser **Web Speech API**, with push-to-talk on the board.
- **Hybrid generation.** Admin "Prepare" builds the lesson plan and segment outlines. During class, the AI expands each segment live.
- **Gemini for everything** (planning, live elaboration, Q&A, embeddings). Claude/Anthropic is removed for now. All LLM calls go through one file (`web/lib/llm.ts`) so we can switch back later.
- **Python services run locally on this Mac** (MPS/CPU).
- **No student accounts.** Roles are `admin` and `classroom` (the board device). `students` is only a roster.

First implementation step after approval: copy this plan to `ai_board/plan.md`.

---

## 1. Repo structure

```
ai_board/
├── plan.md
├── .env.example                  # every var from §4, commented
├── syllabus/document.pdf         # only content source
├── supabase/
│   └── migrations/0001_init.sql  # whole schema, RLS, match_chunks(), realtime publication
├── web/                          # Next.js 15 App Router + TS + Tailwind (the only app)
│   ├── app/
│   │   ├── login/page.tsx
│   │   ├── admin/page.tsx                 # sessions list, live alerts feed (Realtime)
│   │   ├── admin/sessions/[id]/page.tsx   # plan review, progress, engagement chart, "Join class" (Daily), recordings
│   │   ├── classroom/[id]/page.tsx        # the board: runner, narration, mic, webcam sampler, recorder, Daily iframe
│   │   └── api/…                          # routes in §3a
│   ├── components/Board.tsx               # DOM/SVG board, animates board ops
│   ├── lib/
│   │   ├── llm.ts        # Gemini: plan(), elaborate(), answer(), embed(). The only file that knows the provider
│   │   ├── prompts.ts
│   │   ├── supabase.ts   # browser + server(service-role) clients
│   │   ├── services.ts   # fetch wrappers for voice/vision (adds X-Service-Key)
│   │   ├── alerts.ts     # engagement → alert rules
│   │   └── types.ts      # BoardStep, Segment, etc.
│   └── middleware.ts     # role gate: /admin → admin, /classroom → classroom|admin
└── services/
    ├── voice/   main.py, requirements.txt   # FastAPI + OmniVoice, :8001
    └── vision/  main.py, requirements.txt   # FastAPI + rfdetr, :8002
```

We skip a shared `packages/` directory. Nothing is shared across languages except two small HTTP contracts (§3b), which live in `types.ts` and the pydantic models. Add a shared package when a second TS app appears.

## 2. Class flow (what the schema serves)

1. **Ingest** (admin uploads the PDF): the file goes to Storage bucket `syllabus`. Next extracts the text (`unpdf`), splits it into chunks of about 800 tokens by page and heading, embeds them with Gemini, and stores them in `chunks`.
2. **Prepare** (admin, before class): Gemini receives the full PDF text and returns a plan as structured JSON: objectives plus about 8–12 segments whose `planned_minutes` add up to 50. Each segment has a title, kind, key points, a board outline, and `chunk_ids`. Prepare also creates the Daily room. Session status becomes `ready`.
3. **Live** (the classroom device opens `/classroom/[id]` and clicks Start, which also approves the tab-capture prompt):
   - **Runner** is a client-side state machine that goes segment by segment. For each segment it asks `/api/segments/:id/beat` for the next roughly 60–90 s "beat". The request includes the key points, RAG chunks, what has been said so far, and the time left. The response is `{steps: BoardStep[], done}`, where each step is `{say, board_ops[]}`.
   - Each `say` is sent to `/api/tts`, which calls OmniVoice. The audio plays while `Board` animates `board_ops` over the clip's duration.
   - **Prefetch:** while beat N plays, the runner fetches beat N+1 and its audio. This hides the latency of Gemini and OmniVoice on the Mac.
   - **Pacing:** each segment stops at `done` or when its `planned_minutes` runs out. If the class runs behind, the next prompt says "wrap up". `sessions.current_segment` is written on every transition so the admin sees progress.
   - **Question:** someone holds the mic button (or Space). Web Speech returns a transcript, the runner pauses, and `/api/sessions/:id/ask` runs RAG plus Gemini and returns answer steps. The answer is spoken and written on the board, then the class resumes. The question and answer are saved to `questions`.
   - **Engagement:** every 2 s the page takes a JPEG from the webcam and posts it to `/api/sessions/:id/frame`. That route calls vision, stores the result in `engagement_samples`, and evaluates the alert rules, which may insert rows into `alerts`.
   - **Recording:** `getDisplayMedia({preferCurrentTab, audio})` captures the board tab plus narration audio. MediaRecorder cuts a new standalone `.webm` part every 10 min. Each part is uploaded to a signed Storage URL and gets a `recordings` row.
   - **Daily:** the classroom tab shows the prebuilt Daily iframe in a corner, joined with the room camera and mic. An admin who clicks Join gets an owner token and appears there.
4. **Admin:** subscribes to Supabase Realtime `alerts` and `sessions` changes, sees toasts, acknowledges alerts, and can join any live room.

## 3. Postgres schema (`supabase/migrations/0001_init.sql`)

```sql
create extension if not exists vector;

create type user_role      as enum ('admin','classroom');
create type session_status as enum ('draft','preparing','ready','live','ended','failed');
create type segment_kind   as enum ('intro','teach','example','check','recap');
create type segment_status as enum ('pending','live','done','skipped');
create type alert_kind     as enum ('low_engagement','phones','headcount_drop','empty_room','service_down','stalled','question');
create type alert_severity as enum ('info','warn','critical');

create table profiles (                        -- 1:1 with auth.users
  id uuid primary key references auth.users on delete cascade,
  role user_role not null,
  display_name text
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  storage_path text not null,                  -- syllabus/<id>.pdf
  created_at timestamptz default now()
);

create table chunks (                          -- RAG store
  id bigint generated always as identity primary key,
  document_id uuid not null references documents on delete cascade,
  idx int not null,
  page int,
  content text not null,
  embedding vector(768) not null               -- gemini embedding, output_dimensionality=768
);
create index on chunks using hnsw (embedding vector_cosine_ops);
-- match_chunks(query_embedding vector(768), doc uuid, k int) returns setof chunks  (cosine, security definer)

create table students (                        -- roster only; room cam can't identify individuals
  id uuid primary key default gen_random_uuid(),
  class_group text not null,
  name text not null
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents,
  title text not null,
  class_group text,                            -- links to students roster
  status session_status not null default 'draft',
  duration_min int not null default 50,
  current_segment int,                         -- idx, live progress for admin
  daily_room_name text,
  daily_room_url text,
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  created_by uuid references profiles,
  created_at timestamptz default now()
);

create table lesson_plans (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references sessions on delete cascade,
  model text not null,                         -- e.g. gemini model id used
  summary text,
  objectives text[] not null default '{}',
  raw jsonb not null,                          -- full LLM output, for debugging/regeneration
  created_at timestamptz default now()
);

create table segments (
  id uuid primary key default gen_random_uuid(),
  lesson_plan_id uuid not null references lesson_plans on delete cascade,
  idx int not null,
  title text not null,
  kind segment_kind not null,
  planned_minutes numeric(4,1) not null,
  key_points text[] not null default '{}',
  board_outline jsonb not null default '[]',   -- planned headings/formulas
  chunk_ids bigint[] not null default '{}',
  status segment_status not null default 'pending',
  transcript text not null default '',         -- what was actually said live (appended per beat)
  started_at timestamptz,
  ended_at timestamptz,
  unique (lesson_plan_id, idx)
);

create table questions (                       -- spoken Q&A log
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions on delete cascade,
  segment_id uuid references segments,
  transcript text not null,
  answer text,
  asked_at timestamptz default now()
);

create table engagement_samples (
  id bigint generated always as identity primary key,
  session_id uuid not null references sessions on delete cascade,
  at timestamptz not null default now(),
  person_count int not null,
  phone_count int not null,
  score real not null                          -- 0..1, computed in web/lib/alerts.ts
);
create index on engagement_samples (session_id, at);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions on delete cascade,
  kind alert_kind not null,
  severity alert_severity not null,
  message text not null,
  payload jsonb not null default '{}',
  created_at timestamptz default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references profiles
);

create table recordings (                      -- one row per 10-min part
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions on delete cascade,
  part int not null,
  storage_path text not null,                  -- recordings/<session>/<part>.webm
  duration_s int,
  bytes bigint,
  created_at timestamptz default now(),
  unique (session_id, part)
);

alter publication supabase_realtime add table alerts, sessions;
```

**RLS:** enable on every table. `admin` can select and update everything. `classroom` can select `sessions`, `lesson_plans`, `segments`, and `recordings`. All writes go through Next API routes that use the service-role key after checking the caller's role, so clients never write directly. Storage buckets `syllabus` and `recordings` are private and readable through signed URLs.

## 3a. Next.js API routes (browser → Next)

| Route | Who | Does |
|---|---|---|
| `POST /api/documents` | admin | upload PDF, extract, chunk, embed, insert `chunks` |
| `POST /api/sessions` | admin | create session `{document_id,title,class_group,duration_min}` |
| `POST /api/sessions/:id/prepare` | admin | Gemini plan → `lesson_plans` + `segments`; create Daily room; status `ready` |
| `POST /api/sessions/:id/start` / `end` | classroom | status + timestamps |
| `POST /api/segments/:id/beat` | classroom | `{said_so_far, seconds_left}` → `{steps: BoardStep[], done}`; appends transcript |
| `POST /api/sessions/:id/ask` | classroom | `{transcript, segment_id}` → `{steps: BoardStep[]}`; logs `questions` + info alert |
| `POST /api/tts` | classroom | `{text}` → proxies voice `/tts`, streams `audio/wav` back |
| `POST /api/sessions/:id/frame` | classroom | JPEG body → vision `/detect` → `engagement_samples` + alert rules |
| `POST /api/sessions/:id/recordings` | classroom | `{part}` → signed upload URL; then `PATCH` with bytes/duration |
| `POST /api/sessions/:id/join` | admin | Daily owner meeting token + room URL |
| `PATCH /api/alerts/:id` | admin | acknowledge |

```ts
type BoardOp =
  | { op: 'write'; text: string; style: 'heading'|'bullet'|'formula'|'note' }
  | { op: 'highlight'; match: string }
  | { op: 'clear' };
type BoardStep = { say: string; board_ops: BoardOp[] };
```

## 3b. Next.js ↔ Python microservices contract

Shared rules: services bind to `127.0.0.1` only. Every request except `/health` needs header `X-Service-Key: $SERVICE_KEY` and gets `401` without it. Errors return `{error: string}` with a 4xx/5xx status. Only Next calls these services, never the browser, so no CORS is needed.

**Voice: `services/voice` (OmniVoice), `:8001`**
```
GET  /health  → 200 {"ok":true,"model":"OmniVoice","device":"mps","warm":true}
POST /tts
  req  application/json {"text": str (1..600 chars, one or a few sentences),
                         "speed": float = 1.0}
  res  200 audio/wav (24 kHz mono), header X-Duration-Ms: int
       422 text too long/empty · 503 model not loaded
```
The voice (reference clip plus transcript for OmniVoice cloning) is fixed per service through env vars, which fits a demo with one teacher voice. Add a `voice` field if a second voice is needed. The model loads at startup, and a warm-up call runs once.

**Vision: `services/vision` (RF-DETR Nano by default), `:8002`**
```
GET  /health  → 200 {"ok":true,"model":"rfdetr-nano","device":"mps"}
POST /detect
  req  image/jpeg body (≤ 1280px wide)
  res  200 {"persons": int, "phones": int,
            "detections": [{"label": str, "conf": float, "box": [x1,y1,x2,y2]}],
            "inference_ms": int}
```
Vision only reports counts. Scoring and alert policy live in `web/lib/alerts.ts`, so thresholds can change without restarting Python:
- `score = persons ? 1 - min(phones/persons, 1) : 0`
- `phones`: phones ≥ 2 in 3 consecutive samples → warn
- `headcount_drop`: persons < 70% of the session's median → warn
- `empty_room`: persons = 0 for 30 s → critical
- `low_engagement`: 1-min average score < 0.6 → warn
- `service_down` (voice, vision, or Gemini call failed twice) / `stalled` (no beat for 60 s) → critical
- An alert of the same kind is not raised again within 2 min.

`ponytail:` COCO RF-DETR sees people and phones, not gaze. The score is a proxy for attention, not a measure of it. If the demo needs real attention signals, fine-tune on "facing board / not" crops or add a head-pose model.

## 4. Accounts, keys, env vars

**Accounts to create**
1. **Supabase project** (free tier works). Enable `vector`, create buckets `syllabus` and `recordings`, and create 2 auth users (admin, classroom) plus `profiles` rows. The free plan limits uploads to **50 MB per file**, which is why recordings are split into 10-min parts.
2. **Google AI Studio → Gemini API key.**
3. **Daily.co account** (free tier) → API key.
4. **Hugging Face account**, optional. It's only needed if an OmniVoice or RF-DETR checkpoint download requires auth.
5. Chrome on the demo Mac, which Web Speech and tab-capture audio need, plus an internet connection because Web Speech uses Google servers.
6. Not needed now: an Anthropic API key (Gemini replaced Claude everywhere).

**`web/.env.local`**
| Var | Secret? | Value |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | no | project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | no | publishable/anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | server routes only |
| `GEMINI_API_KEY` | **yes** | AI Studio |
| `GEMINI_MODEL` | no | current Flash/Pro id, chosen at implementation time |
| `GEMINI_EMBED_MODEL` | no | Gemini embedding model id (768-dim output) |
| `DAILY_API_KEY` | **yes** | Daily dashboard |
| `VOICE_URL` | no | `http://127.0.0.1:8001` |
| `VISION_URL` | no | `http://127.0.0.1:8002` |
| `SERVICE_KEY` | **yes** | random 32 bytes, same value in both services |

**`services/voice/.env`:** `SERVICE_KEY`, `VOICE_DEVICE=mps`, `VOICE_REF_AUDIO=./ref.wav`, `VOICE_REF_TEXT="…"`, `HF_TOKEN` (optional).
**`services/vision/.env`:** `SERVICE_KEY`, `VISION_MODEL=nano` (`nano`/`small`), `VISION_CONF=0.5`, `VISION_DEVICE=mps`.

## Risks (flagged, not solved yet)
- **OmniVoice speed on a Mac is unknown.** If one sentence takes longer to synthesize than to speak, prefetch can't keep up. Fallback: `/api/tts` errors or times out after 8 s, and the client uses `speechSynthesis`. Benchmark this on day 1 before building the UI.
- **Webcam shared by Daily and the frame sampler:** both tabs/iframes open the same camera, which Chrome on macOS allows. Verify early.
- **Mic picks up narration:** push-to-talk only, and narration pauses while the mic is held.

## Verification
1. Run `supabase db push` for the migration, then check with `list_tables`. Test `match_chunks` against the ingested syllabus with a `select`.
2. Run `curl` against each service: `/health`; `/tts` → play the wav and check `X-Duration-Ms`; `/detect` with a classroom photo → correct person count. Run once without the key and expect 401.
3. Admin flow: upload the PDF, Prepare, then check that the segment `planned_minutes` sum to 50 and the Daily room URL exists.
4. Classroom flow at `duration_min=5` for fast iteration: beats play with board animation, a spoken question gets answered and resumes the class, covering the webcam triggers `empty_room` in the admin tab within about 30 s, and the recording parts play back from signed URLs.
5. Full 50-minute dry run before the demo.
