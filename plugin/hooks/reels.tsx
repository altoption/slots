import type { ClientModule } from 'claude-code'

// The slot window, drawn on the surface's own frame clock so the spin is smooth and costs the plugin
// nothing per frame. The plugin only says "spinning" or hands over the result; this module animates
// the reels and stops them one after another, left to right.

type Cell = { reel: number; row: number }
export type ReelsProps = { grid: string[][]; cells: Cell[]; isSpinning: boolean; columns: number }
type Mode = 'idle' | 'spin' | 'settle'
type ReelsState = { mode: Mode; frame: number; now: number; settleStart: number; wasSpinning: boolean }

const TICK_MS = 50
const STOP_GAP_MS = 120 // between one reel stopping and the next
const REELS = 5

// Barn of Fortune symbol ids (from slots-sdk) → glyph + short label.
const SYMBOLS: Record<string, { glyph: string; label: string }> = {
  hay: { glyph: '🌾', label: 'HAY' },
  apple: { glyph: '🍎', label: 'APPLE' },
  horseshoe: { glyph: '🍀', label: 'LUCK' },
  lantern: { glyph: '🌻', label: 'MILL' },
  tractor: { glyph: '🐄', label: 'COW' },
  pig: { glyph: '🐖', label: 'PIG' },
  star: { glyph: '🌽', label: 'CORN' },
  wild: { glyph: '🐓', label: 'WILD' },
  scatter: { glyph: '🏠', label: 'BARN' },
}
const IDS = Object.keys(SYMBOLS)
const sym = (id: string) => SYMBOLS[id] ?? { glyph: '❔', label: id.slice(0, 5).toUpperCase() }

// A blur symbol for a spinning cell: changes every frame, differs per cell, no randomness needed.
const blur = (frame: number, reel: number, row: number) => IDS[(frame * 3 + reel * 5 + row * 7 + reel * frame) % IDS.length] ?? 'hay'

const Reels: ClientModule<ReelsProps, ReelsState> = (props, surface) => {
  const { Box, Text } = surface.elements
  let s = surface.state

  if (!s) {
    // Start the clock once. It only redraws while something moves.
    surface.every(TICK_MS, () => {
      const cur = surface.state
      if (!cur || cur.mode === 'idle') return
      const now = cur.now + TICK_MS
      const done = cur.mode === 'settle' && now >= cur.settleStart + STOP_GAP_MS * REELS
      surface.setState({ ...cur, now, frame: cur.frame + 1, mode: done ? 'idle' : cur.mode })
    })
    s = { mode: props.isSpinning ? 'spin' : 'idle', frame: 0, now: 0, settleStart: 0, wasSpinning: props.isSpinning }
    surface.setState(s)
  } else if (props.isSpinning !== s.wasSpinning) {
    // The plugin started a spin, or handed over its result: start spinning, or start stopping reels.
    s = props.isSpinning
      ? { ...s, mode: 'spin', wasSpinning: true }
      : { ...s, mode: 'settle', settleStart: s.now, wasSpinning: false }
    surface.setState(s)
  }

  const reels = props.grid.length
  const rows = props.grid[0]?.length ?? 3
  const isStopped = (reel: number) =>
    s!.mode === 'idle' || (s!.mode === 'settle' && s!.now >= s!.settleStart + STOP_GAP_MS * (reel + 1))
  const symbolAt = (reel: number, row: number) => (isStopped(reel) ? (props.grid[reel]?.[row] ?? 'hay') : blur(s!.frame, reel, row))
  const isWin = (reel: number, row: number) => s!.mode === 'idle' && props.cells.some(c => c.reel === reel && c.row === row)

  // Narrow pane: one text row per window row, winners starred.
  if (props.columns < 26) {
    return (
      <Box flexDirection="column">
        {Array.from({ length: rows }, (_, row) => (
          <Text key={`row-${row}`}>
            {Array.from({ length: reels }, (_, reel) => sym(symbolAt(reel, row)).glyph + (isWin(reel, row) ? '*' : ' ')).join('')}
          </Text>
        ))}
      </Box>
    )
  }

  // Wide pane: glyph over label in each cell; medium: glyph only.
  const isWide = props.columns >= 50
  return (
    <Box flexDirection="row">
      {Array.from({ length: reels }, (_, reel) => (
        <Box key={`reel-${reel}`} flexDirection="column">
          {Array.from({ length: rows }, (_, row) => {
            const id = symbolAt(reel, row)
            const win = isWin(reel, row)
            return (
              <Box
                key={`cell-${reel}-${row}`}
                width={isWide ? 9 : 5}
                flexDirection="column"
                alignItems="center"
                borderStyle={win ? 'bold' : 'single'}
                borderColor={win ? 'warning' : isStopped(reel) ? undefined : 'subtle'}
              >
                <Text>{sym(id).glyph}</Text>
                {isWide ? (
                  <Text bold={win} color={win ? 'warning' : undefined}>
                    {sym(id).label}
                  </Text>
                ) : null}
              </Box>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}

export default Reels
