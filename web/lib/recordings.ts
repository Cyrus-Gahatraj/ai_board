import { join } from 'node:path'

// ponytail: recordings live on local disk next to the app; move to object storage when this leaves one machine.
export const RECORDINGS_DIR = join(process.cwd(), 'recordings')
export const recordingPath = (sessionId: string) => join(RECORDINGS_DIR, `${sessionId}.webm`)
