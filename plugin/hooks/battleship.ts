import type { Sea, Shooter, Ship, Shot } from '../types'

// Battleship, solo: a 10×10 sea hides five ships. You and Claude fire at the same sea; sink them all in
// as few shots as you can. Pure functions; register.tsx keeps the game in the plugin store.

export const SIZE = 10
export const FLEET = [
  { name: 'Carrier', size: 5 },
  { name: 'Battleship', size: 4 },
  { name: 'Cruiser', size: 3 },
  { name: 'Submarine', size: 3 },
  { name: 'Destroyer', size: 2 },
] as const


// "A1" … "J10": column letter, then row number. Cells count left to right, top to bottom.
export const coord = (cell: number) => 'ABCDEFGHIJ'[cell % SIZE] + String(Math.floor(cell / SIZE) + 1)

// A small seeded generator (xorshift32), so a sea can be rebuilt and tested from its seed.
export const rngFrom = (seed: string) => {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0
  let s = h || 2654435769
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

// Places the fleet at random, each ship in a straight line, none overlapping.
export const newSea = (seed: string): Sea => {
  const rand = rngFrom(seed)
  const taken = new Set<number>()
  const ships: Ship[] = []
  for (const { name, size } of FLEET) {
    for (;;) {
      const across = rand() < 0.5
      const x = Math.floor(rand() * (across ? SIZE - size + 1 : SIZE))
      const y = Math.floor(rand() * (across ? SIZE : SIZE - size + 1))
      const cells = Array.from({ length: size }, (_, k) => (across ? y * SIZE + x + k : (y + k) * SIZE + x))
      if (cells.some(c => taken.has(c))) continue
      cells.forEach(c => taken.add(c))
      ships.push({ name, cells })
      break
    }
  }
  return { ships, shots: [] }
}

export const isShot = (sea: Sea, cell: number) => sea.shots.some(s => s.cell === cell)
export const shipAt = (sea: Sea, cell: number) => sea.ships.find(s => s.cells.includes(cell))
export const isSunk = (sea: Sea, ship: Ship) => ship.cells.every(c => isShot(sea, c))
export const isWon = (sea: Sea) => sea.ships.every(s => isSunk(sea, s))
export const hits = (sea: Sea) => sea.shots.filter(s => s.result !== 'miss').length

// Fires at a cell. A cell already shot, or a sea already won, is left as it was (null).
export const fire = (sea: Sea, cell: number, by: Shooter): { sea: Sea; shot: Shot } | null => {
  if (cell < 0 || cell >= SIZE * SIZE || isShot(sea, cell) || isWon(sea)) return null
  const ship = shipAt(sea, cell)
  const after: Sea = { ...sea, shots: [...sea.shots, { cell, by, result: 'miss' }] }
  const shot: Shot = !ship ? { cell, by, result: 'miss' } : isSunk(after, ship) ? { cell, by, result: 'sunk', ship: ship.name } : { cell, by, result: 'hit', ship: ship.name }
  return { sea: { ...sea, shots: [...sea.shots, shot] }, shot }
}

const neighbours = (cell: number) => {
  const x = cell % SIZE
  const y = Math.floor(cell / SIZE)
  return [
    x > 0 ? cell - 1 : -1,
    x < SIZE - 1 ? cell + 1 : -1,
    y > 0 ? cell - SIZE : -1,
    y < SIZE - 1 ? cell + SIZE : -1,
  ].filter(c => c >= 0)
}

/**
 * Claude's aim: hunt, then target. Next to a hit on a ship not yet sunk, it fires along the line two
 * hits make, else beside any such hit; with none, a random untried square on a checkerboard (every
 * ship covers one). A sure shot (a 🏆 bonus) hits a ship.
 */
export const aim = (sea: Sea, rand: () => number, isSure = false): number | null => {
  const open = (c: number) => !isShot(sea, c)
  const pickFrom = (cells: number[]) => (cells.length ? cells[Math.floor(rand() * cells.length)]! : null)
  if (isWon(sea)) return null
  if (isSure) {
    const afloat = sea.ships.filter(s => !isSunk(sea, s))
    // The square a targeted shot would choose, when it is a hit; else any untouched ship square.
    const target = aim(sea, rand)
    if (target !== null && shipAt(sea, target)) return target
    return pickFrom(afloat.flatMap(s => s.cells.filter(open)))
  }
  const live = sea.shots.filter(s => s.result === 'hit' && !isSunk(sea, shipAt(sea, s.cell)!)).map(s => s.cell)
  for (const a of live) {
    for (const b of live) {
      if (a === b || !neighbours(a).includes(b)) continue
      const step = b - a
      const line = [b + step, a - step].filter(c => c >= 0 && c < SIZE * SIZE && open(c) && neighbours(c).some(n => n === a || n === b))
      if (line.length) return pickFrom(line)
    }
  }
  const beside = [...new Set(live.flatMap(neighbours))].filter(open)
  if (beside.length) return pickFrom(beside)
  const all = Array.from({ length: SIZE * SIZE }, (_, c) => c).filter(open)
  const parity = all.filter(c => ((c % SIZE) + Math.floor(c / SIZE)) % 2 === 0)
  return pickFrom(parity.length ? parity : all)
}

// The sea as saved by an earlier session, checked before use: anything odd starts a new game.
export const isSea = (x: unknown): x is Sea => {
  const s = x as Sea
  const cellOk = (c: unknown) => Number.isInteger(c) && (c as number) >= 0 && (c as number) < SIZE * SIZE
  return (
    typeof s === 'object' && s !== null && Array.isArray(s.ships) && Array.isArray(s.shots) &&
    s.ships.length === FLEET.length &&
    s.ships.every(sh => typeof sh?.name === 'string' && Array.isArray(sh.cells) && sh.cells.every(cellOk)) &&
    s.shots.every(sh => cellOk(sh?.cell) && (sh.by === 'you' || sh.by === 'claude') && ['miss', 'hit', 'sunk'].includes(sh.result))
  )
}
