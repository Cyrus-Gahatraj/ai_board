import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { ADMIN_COOKIE } from '@/lib/auth.ts'
import { LiveUpdates } from './LiveUpdates.tsx'

async function logout() {
  'use server'
  ;(await cookies()).delete(ADMIN_COOKIE)
  redirect('/admin/login')
}

// The login page lives under /admin too, but only signed-in pages get the header (middleware guarantees that).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const signedIn = (await cookies()).has(ADMIN_COOKIE)
  if (!signedIn) return children
  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
        <Link href="/admin" className="flex items-baseline gap-3">
          <span className="font-hand text-4xl text-[#f7d774]">AI Board</span>
          <span className="text-sm uppercase tracking-wide text-neutral-400">Teacher dashboard</span>
        </Link>
        <div className="flex items-center gap-4">
          <LiveUpdates />
          <Link href="/admin/new" className="text-sm text-neutral-400 hover:text-neutral-200">Plan a lesson</Link>
          <form action={logout}><button className="text-sm text-neutral-400 hover:text-neutral-200">Sign out</button></form>
        </div>
      </header>
      <div className="p-6">{children}</div>
    </div>
  )
}
