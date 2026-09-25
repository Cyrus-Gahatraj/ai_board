import { redirect } from 'next/navigation'

// Teachers plan lessons in the dashboard; smart boards open /board/<room>. Nothing for students to do here.
export default function Home() {
  redirect('/admin')
}
