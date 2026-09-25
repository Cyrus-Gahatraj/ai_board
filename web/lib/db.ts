import postgres from 'postgres'

// Server code only. Supabase Postgres from DATABASE_URL (see .env).
// Cached on globalThis so Next dev hot-reloads don't open a new pool each time.
// prepare: false because Supabase's transaction pooler (port 6543) doesn't support prepared statements.
const g = globalThis as { __sql?: postgres.Sql }
export const sql = (g.__sql ??= postgres(process.env.DATABASE_URL!, { prepare: false, onnotice: () => {} }))

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
