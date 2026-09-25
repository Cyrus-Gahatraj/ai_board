import { Caveat } from 'next/font/google'
import './globals.css'

const hand = Caveat({ subsets: ['latin'], variable: '--font-caveat' })

export const metadata = { title: 'AI Board' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={hand.variable}>
      <body className="bg-neutral-900">{children}</body>
    </html>
  )
}
