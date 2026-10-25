// Hand-written typings for the parts of vendor/slots-engine.js this repo uses.
export type GamePack = {
  meta: { id: string; name: string }
  grid: { reels: number; rows: number }
  symbols: { id: string; name: string; pays?: Record<string, number> }[]
  lines: { lines: { id: string; path: number[] }[] }
}
export type WinEntry = { source: string; symbol: string; count: number; amount: number; lineId?: string; cells: { reel: number; row: number }[] }
export type HandResult = { rank: string; ordinal: number; label: string; contributing: number[] }
export type SpinOutcome = { grid: string[][]; stops: number[]; wins: WinEntry[]; totalWin: number; triggered?: unknown }
export function runSpin(game: GamePack, request: { betLevel: number; activeLines: number; seed?: string }): SpinOutcome
export function dealFromSeed(seed: string): { shoe: string[]; dealt: string[] }
export function resolvePokerRound(
  game: GamePack,
  opts: { seed: string; holdMask: number; bet: number },
): { dealt: string[]; final: string[]; holdMask: number; result: HandResult; payMultiplier: number; win: number }
export function scoreDealt(game: GamePack, dealt: readonly string[], bet: number): { result: HandResult; win: number }
export function holdsToMask(holds: readonly number[]): number
export const barnOfFortune: GamePack
export const royalDraw: GamePack
