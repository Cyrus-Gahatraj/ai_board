import postgres from 'postgres'

// Server code only. Local Postgres from DATABASE_URL (see .env).
// Cached on globalThis so Next dev hot-reloads don't open a new pool each time.
const g = globalThis as { __sql?: postgres.Sql }
export const sql = (g.__sql ??= postgres(process.env.DATABASE_URL!, { onnotice: () => {} }))

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
