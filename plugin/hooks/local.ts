import { barnOfFortune, dealFromSeed, holdsToMask, resolvePokerRound, royalDraw, runSpin, scoreDealt } from './engine/slots-engine.js'

// The games, played on this machine with the slots-sdk engine. Every play is a function of its seed;
// nothing is bet and nothing is won but points on the screen.

// The paytables are written per bet: plays use a fixed one, so a win reads the same every time.
export const BET = 10
const LINES = barnOfFortune.lines.lines.length

export const newSeed = () => crypto.randomUUID()

export type Spin = { grid: string[][]; win: number; cells: { reel: number; row: number }[] }

export const spinFrom = (seed: string): Spin => {
  const o = runSpin(barnOfFortune, { betLevel: BET, activeLines: LINES, seed })
  return { grid: o.grid, win: Math.floor(o.totalWin), cells: o.wins.flatMap(w => w.cells) }
}

export type Deal = { seed: string; dealt: string[]; made: string | null; contributing: number[]; ordinal: number }

export const dealFrom = (seed: string): Deal => {
  const dealt = dealFromSeed(seed).dealt
  const made = scoreDealt(royalDraw, dealt, BET)
  const paying = made.win > 0
  return { seed, dealt, made: paying ? made.result.label : null, contributing: paying ? made.result.contributing : [], ordinal: made.result.ordinal }
}

export type Draw = { final: string[]; result: string; win: number; contributing: number[] }

export const drawFrom = (seed: string, holds: readonly number[]): Draw => {
  const r = resolvePokerRound(royalDraw, { seed, holdMask: holdsToMask(holds), bet: BET })
  const win = Math.floor(r.win)
  return { final: r.final, result: r.result.label, win, contributing: win > 0 ? r.result.contributing : [] }
}

// ---- bonus plays: a milestone picks a winning seed ----------------------------------------------

// About 1 spin in 60 pays 10× and 1 deal in 35 is Three of a Kind or better, so 1,500 tries all but
// never miss; if they do, the best seen is played.
export const BONUS_TRIES = 1500
// A bonus spin pays at least 10× the bet; a bonus deal is dealt Three of a Kind or better.
export const BONUS_SPIN_WIN = 10 * BET
export const BONUS_DEAL_ORDINAL = 3

// The first of up to `tries` seeds whose score reaches `target`, else the best one seen.
const pick = <T>(make: (seed: string) => T, score: (t: T) => number, target: number, seeds: () => string, tries: number): T => {
  let best = make(seeds())
  for (let i = 1; i < tries && score(best) < target; i++) {
    const t = make(seeds())
    if (score(t) > score(best)) best = t
  }
  return best
}

export const bonusSpin = (seeds = newSeed, tries = BONUS_TRIES): Spin => pick(spinFrom, s => s.win, BONUS_SPIN_WIN, seeds, tries)
export const bonusDeal = (seeds = newSeed, tries = BONUS_TRIES): Deal => pick(dealFrom, d => d.ordinal, BONUS_DEAL_ORDINAL, seeds, tries)

// ---- milestones, read from a Bash command that succeeded ----------------------------------------

export type Milestone = 'commit' | 'pr'

// Each command of a chain counts on its own, a dry run never; a PR outranks a commit.
export const milestoneOf = (command: string): Milestone | null => {
  let found: Milestone | null = null
  for (const part of command.split(/&&|\|\||;|\n/)) {
    const words = part.trim().split(/\s+/)
    if (words.includes('--dry-run')) continue
    if (words[0] === 'gh' && words[1] === 'pr' && words[2] === 'create') return 'pr'
    if (words[0] === 'git' && words.includes('commit')) found = 'commit'
  }
  return found
}
