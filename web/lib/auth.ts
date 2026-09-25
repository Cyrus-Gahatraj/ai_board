// Admin gate: one password from .env, remembered in an HMAC-signed cookie. Edge-safe (Web Crypto only),
// so middleware can use it. Changing ADMIN_PASSWORD signs everyone out.
export const ADMIN_COOKIE = 'board_admin'

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')

async function hmac(key: string, msg: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)))
}

// Constant-time compare, so response timing doesn't leak how much of a guess was right.
function same(a: string, b: string) {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

export async function adminToken(): Promise<string | null> {
  const pw = process.env.ADMIN_PASSWORD
  return pw ? hmac(pw, 'ai-board-admin-v1') : null // no password set = admin locked
}

export async function isAdminToken(token: string | undefined) {
  const want = await adminToken()
  return !!want && !!token && same(token, want)
}

export async function checkPassword(given: string) {
  const pw = process.env.ADMIN_PASSWORD
  return !!pw && same(await hmac('cmp', given), await hmac('cmp', pw)) // hash first so lengths match
}
