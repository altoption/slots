export type Cell = { reel: number; row: number }

// What a milestone earned: the next play is a bonus. A PR outranks a commit, a commit passing tests.
export type Bonus = 'tests' | 'commit' | 'pr'

export type CasinoView = {
  tab: 'slots' | 'poker' | 'pomodoro'
  message: string
  isPaneOpen: boolean
  // The clock as of the last change, for the Pomodoro countdown.
  now: number
  bonus: Bonus | null
  // Points are for fun: nothing is bet, bought or paid out.
  stats: { plays: number; points: number; best: number }
  slots: { grid: string[][]; win: number; cells: Cell[]; isSpinning: boolean; isBonus: boolean; message: string }
  poker: {
    cards: (string | null)[]
    held: boolean[]
    winning: number[]
    phase: 'idle' | 'dealt' | 'drawn'
    // The deal's seed: a timer set for one hand never acts on another.
    handId: string
    // The player changed a hold since the deal: Claude's auto-draw leaves the hand to them.
    touched: boolean
    isBonus: boolean
    result: string
    win: number
    message: string
  }
  // The Pomodoro timer: runs on this machine only, kept in the plugin store across restarts.
  pomo: Pomo
  calib: { settled: number; brier: number | null; pending: number | null }
}

export type Pomo = {
  phase: 'focus' | 'short' | 'long'
  // Running: when the phase ends. Paused or not started: null, and leftMs holds the time left.
  endsAt: number | null
  leftMs: number
  // Focus sessions finished in this round of four (the fourth earns the long break).
  round: number
  // Focus sessions finished on `day` (a local date).
  today: number
  day: string
}

declare module 'claude-code' {
  interface PluginState {
    'terminal-slots': { view: Shaped<CasinoView> }
  }
}
