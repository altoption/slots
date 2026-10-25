export type Cell = { reel: number; row: number }

export type CasinoView = {
  tab: 'slots' | 'poker'
  account: { login: string; balance: number; nextLootboxMs: number; isMember: boolean; canRefill: boolean } | null
  device: { userCode: string; uri: string } | null
  message: string
  isBusy: boolean
  isPaneOpen: boolean
  slots: { grid: string[][]; bet: number; win: number; cells: Cell[]; isSpinning: boolean; message: string }
  poker: { cards: (string | null)[]; held: boolean[]; winning: number[]; phase: 'idle' | 'dealt' | 'drawn'; bet: number; result: string; win: number; message: string }
  calib: { settled: number; brier: number | null; pending: number | null }
}

declare module 'claude-code' {
  interface PluginState {
    'terminal-slots': { view: Shaped<CasinoView> }
  }
}
