import type { Pomo } from '../types'

// The classic Pomodoro: 25 minutes of focus, a 5-minute break, and a 15-minute break after every
// fourth focus session. Pure functions; register.tsx keeps the state, the timers and the store.

export const POMO_MS: Record<Pomo['phase'], number> = { focus: 25 * 60_000, short: 5 * 60_000, long: 15 * 60_000 }
export const ROUND = 4

export const PHASE_LABEL: Record<Pomo['phase'], string> = { focus: '🍅 Focus', short: '☕ Short break', long: '🌴 Long break' }

// A local calendar date, so "today" resets at the player's midnight.
export const dayOf = (now: number) => new Date(now).toDateString()

export const newPomo = (): Pomo => ({ phase: 'focus', endsAt: null, leftMs: POMO_MS.focus, round: 0, today: 0, day: '' })

export const pomoLeft = (p: Pomo, now: number) => (p.endsAt === null ? p.leftMs : Math.max(0, p.endsAt - now))

export const isRunning = (p: Pomo) => p.endsAt !== null

// A saved timer from an older version or a damaged store starts over instead of breaking the pane.
export const isPomo = (x: unknown): x is Pomo => {
  const p = x as Pomo
  return (
    typeof p === 'object' && p !== null && p.phase in POMO_MS &&
    (p.endsAt === null || typeof p.endsAt === 'number') &&
    [p.leftMs, p.round, p.today].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0) &&
    typeof p.day === 'string'
  )
}

export const startPomo = (p: Pomo, now: number): Pomo => (isRunning(p) ? p : { ...p, endsAt: now + p.leftMs })
export const pausePomo = (p: Pomo, now: number): Pomo => (isRunning(p) ? { ...p, endsAt: null, leftMs: pomoLeft(p, now) } : p)
export const resetPomo = (p: Pomo): Pomo => ({ ...p, endsAt: null, leftMs: POMO_MS[p.phase] })

/**
 * The next phase, stopped and full length. A finished focus session counts towards today and the
 * round, and the fourth earns the long break; a skipped one counts for nothing. Leaving the long
 * break starts a new round.
 */
export const nextPomo = (p: Pomo, now: number, isFinished: boolean): Pomo => {
  const day = dayOf(now)
  const today = p.day === day ? p.today : 0
  if (p.phase !== 'focus') {
    return { ...p, phase: 'focus', endsAt: null, leftMs: POMO_MS.focus, round: p.phase === 'long' ? 0 : p.round, today, day }
  }
  const round = isFinished ? p.round + 1 : p.round
  const phase = round >= ROUND ? 'long' : 'short'
  return { ...p, phase, endsAt: null, leftMs: POMO_MS[phase], round, today: isFinished ? today + 1 : today, day }
}

// "24:59": minutes and seconds (every phase is under an hour), rounded up so 0:00 means done.
export const clockText = (ms: number) => {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// A bar of `width` cells, filled as the phase runs.
export const progressBar = (p: Pomo, now: number, width: number) => {
  const done = Math.round((1 - pomoLeft(p, now) / POMO_MS[p.phase]) * width)
  return '█'.repeat(Math.max(0, Math.min(width, done))) + '░'.repeat(Math.max(0, width - Math.max(0, done)))
}
