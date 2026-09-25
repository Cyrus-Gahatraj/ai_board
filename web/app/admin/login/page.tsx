import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { ADMIN_COOKIE, adminToken, checkPassword } from '@/lib/auth.ts'

async function login(form: FormData) {
  'use server'
  const next = String(form.get('next') ?? '')
  const dest = next.startsWith('/admin') ? next : '/admin' // only redirect inside the dashboard
  if (!(await checkPassword(String(form.get('password') ?? '')))) redirect(`/admin/login?error=1&next=${encodeURIComponent(dest)}`)
  ;(await cookies()).set(ADMIN_COOKIE, (await adminToken())!, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 12,
  })
  redirect(dest)
}

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-900 p-8 text-neutral-100">
      <form action={login} className="flex w-full max-w-sm flex-col gap-3">
        <h1 className="font-hand text-5xl text-[#f7d774]">Teacher sign-in</h1>
        <input type="hidden" name="next" value={next ?? '/admin'} />
        <label htmlFor="password" className="text-sm text-neutral-400">Password</label>
        <input id="password" name="password" type="password" required autoFocus autoComplete="current-password"
          className="rounded-lg bg-neutral-800 px-4 py-3 outline-none ring-emerald-600 focus:ring-2" />
        {error && <p className="text-sm text-red-400">Wrong password{!process.env.ADMIN_PASSWORD && ' (ADMIN_PASSWORD is not set in .env)'}.</p>}
        <button className="rounded-lg bg-emerald-700 px-4 py-3 font-semibold">Sign in</button>
      </form>
    </main>
  )
}
