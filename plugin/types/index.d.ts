export type Cell = { reel: number; row: number }

export type CasinoView = {
  tab: 'slots' | 'poker' | 'pomodoro'
  account: { login: string; balance: number; nextLootboxMs: number; isMember: boolean; canRefill: boolean } | null
  device: { userCode: string; uri: string } | null
  message: string
  isBusy: boolean
  isPaneOpen: boolean
  // After I'm Rich: a non-supporter sees a support link until their next action.
  showNudge: boolean
  // The clock as of the last tick (every 30 s), for countdowns.
  now: number
  slots: { grid: string[][]; bet: number; win: number; cells: Cell[]; isSpinning: boolean; message: string }
  poker: { cards: (string | null)[]; held: boolean[]; winning: number[]; phase: 'idle' | 'dealt' | 'drawn'; bet: number; result: string; win: number; message: string }
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
