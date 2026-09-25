import type { BoardItem } from '@/lib/script.ts'

const MAX_ITEMS = 12 // ponytail: oldest lines scroll off; a smarter layout can come with diagrams

// Pure render of the board at time `now` (seconds on the segment's audio clock).
// Items appear at `start` and are "handwritten" char by char until `end`.
export function Board({ items, now, className = '' }: { items: BoardItem[]; now: number; className?: string }) {
  const shown = items.filter(i => i.start <= now)
  const lastHeading = shown.findLastIndex(i => i.type === 'heading') // a heading wipes the board
  const visible = shown.slice(Math.max(lastHeading, 0)).slice(-MAX_ITEMS)

  return (
    <div className={`font-hand rounded-2xl border-[14px] border-[#6b4a2b] bg-[#1d3a2c] p-8 text-[#f4f1e8] shadow-2xl ${className}`}>
      <div className="flex flex-wrap content-start gap-x-4 gap-y-2">
        {visible.map(i => {
          const p = i.end > i.start ? Math.min(1, (now - i.start) / (i.end - i.start)) : 1
          const text = i.text.slice(0, Math.ceil(i.text.length * p))
          const caret = p < 1 && <span className="animate-pulse opacity-70">|</span>
          switch (i.type) {
            case 'heading':
              return <h2 key={i.id} className="w-full border-b-2 border-[#f7d774]/60 pb-1 text-5xl text-[#f7d774]">{text}{caret}</h2>
            case 'formula':
              return <div key={i.id} className="w-full pl-6 text-4xl text-[#9fd9ff]">{text}{caret}</div>
            case 'label':
              return <span key={i.id} className="rounded-lg border-2 border-[#f4a5a5]/70 px-3 text-3xl text-[#f4a5a5]">{text}{caret}</span>
            default:
              return <div key={i.id} className="w-full text-4xl">• {text}{caret}</div>
          }
        })}
      </div>
    </div>
  )
}
