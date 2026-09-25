import { NextResponse, type NextRequest } from 'next/server'
import { ADMIN_COOKIE, isAdminToken } from '@/lib/auth.ts'

export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === '/admin/login') return NextResponse.next()
  if (await isAdminToken(req.cookies.get(ADMIN_COOKIE)?.value)) return NextResponse.next()
  if (req.nextUrl.pathname.startsWith('/api/')) return Response.json({ error: 'admin only' }, { status: 401 })
  const login = new URL('/admin/login', req.url)
  login.searchParams.set('next', req.nextUrl.pathname)
  return NextResponse.redirect(login)
}

export const config = { matcher: ['/admin/:path*', '/api/admin/:path*'] }
