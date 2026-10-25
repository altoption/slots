// Pure text renderers for the pane. Each takes the pane's width and degrades: boxed → compact → one line.

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
export const SYMBOL_IDS = Object.keys(SYMBOLS)

const sym = (id: string) => SYMBOLS[id] ?? { glyph: '❔', label: id.slice(0, 5).toUpperCase() }

// Display width: these emoji draw two columns wide in a terminal.
const width = (s: string) => [...s].reduce((n, ch) => n + ((ch.codePointAt(0) ?? 0) > 0x2fff ? 2 : 1), 0)
const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - width(s)))
const center = (s: string, w: number) => {
  const left = Math.floor((w - width(s)) / 2)
  return pad(' '.repeat(Math.max(0, left)) + s, w)
}

export type Cell = { reel: number; row: number }

/**
 * The slot window, `grid[reel][row]`, as lines of text. Winning cells are marked with `*`.
 * ≥ 46 cols: boxed cells with glyph and label; ≥ 26: boxed glyphs; else glyph rows.
 */
export const renderReels = (grid: string[][], columns: number, wins: Cell[] = []): string[] => {
  const reels = grid.length
  const rows = grid[0]?.length ?? 0
  const isWin = (reel: number, row: number) => wins.some(c => c.reel === reel && c.row === row)
  if (columns < 26) {
    return Array.from({ length: rows }, (_, row) => grid.map((col, reel) => sym(col[row] ?? '').glyph + (isWin(reel, row) ? '*' : ' ')).join(''))
  }
  const cw = columns >= 46 ? 8 : 4
  const top = '┌' + Array(reels).fill('─'.repeat(cw)).join('┬') + '┐'
  const mid = '├' + Array(reels).fill('─'.repeat(cw)).join('┼') + '┤'
  const bottom = '└' + Array(reels).fill('─'.repeat(cw)).join('┴') + '┘'
  const out = [top]
  for (let row = 0; row < rows; row++) {
    const cells = grid.map((col, reel) => {
      const s = sym(col[row] ?? '')
      const text = cw === 8 ? `${s.glyph}${s.label}` : s.glyph
      return center(isWin(reel, row) ? `${text}*` : text, cw)
    })
    out.push('│' + cells.join('│') + '│')
    if (row < rows - 1) out.push(mid)
  }
  out.push(bottom)
  return out
}

export const randomGrid = (rand: () => number, reels = 5, rows = 3): string[][] =>
  Array.from({ length: reels }, () => Array.from({ length: rows }, () => SYMBOL_IDS[Math.floor(rand() * SYMBOL_IDS.length)] ?? 'hay'))

// Cards are slots-sdk strings: rank + suit, e.g. "Ts" = ten of spades.
const SUIT: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' }
const rankText = (card: string) => (card[0] === 'T' ? '10' : (card[0] ?? '?'))
export const cardText = (card: string) => rankText(card) + (SUIT[card[1] ?? ''] ?? '?')

/**
 * Five cards as lines. ≥ 44 cols: 7×5 boxed cards; ≥ 28: 5×3; else one line.
 * `held` marks cards with HELD under them; null cards draw face down.
 */
export const renderCards = (cards: (string | null)[], columns: number, held: boolean[] = []): string[] => {
  const mark = (i: number, w: number) => center(held[i] ? 'HELD' : '', w)
  if (columns < 28) {
    return [cards.map(c => (c ? cardText(c) : '##')).map((t, i) => (held[i] ? `[${t}]` : ` ${t} `)).join('')]
  }
  if (columns < 44) {
    const lines = ['', '', '', '']
    cards.forEach((c, i) => {
      const t = c ? pad(cardText(c), 3) : '###'
      lines[0] += '┌───┐ '
      lines[1] += `│${t}│ `
      lines[2] += '└───┘ '
      lines[3] += mark(i, 5) + ' '
    })
    return lines
  }
  const lines = ['', '', '', '', '', '']
  cards.forEach((c, i) => {
    const r = c ? rankText(c) : '#'
    const s = c ? (SUIT[c[1] ?? ''] ?? '?') : '#'
    lines[0] += '┌─────┐ '
    lines[1] += `│${pad(r, 5)}│ `
    lines[2] += `│  ${s}  │ `
    lines[3] += `│${' '.repeat(5 - r.length)}${r}│ `
    lines[4] += '└─────┘ '
    lines[5] += mark(i, 7) + ' '
  })
  return lines
}

/**
 * One card's face, without its border (the pane draws the border, so held and winning cards can
 * change it). `full` is 3 lines × 6 columns; `mini` is 1 line × 3 columns. Null draws face down.
 */
export const cardFace = (card: string | null, size: 'full' | 'mini'): string[] => {
  if (size === 'mini') return [card ? pad(cardText(card), 3) : '░░░']
  if (!card) return ['░░░░░░', '░░░░░░', '░░░░░░']
  const r = rankText(card)
  const s = SUIT[card[1] ?? ''] ?? '?'
  return [pad(r, 6), `  ${s}   `, ' '.repeat(6 - r.length) + r]
}

// Hearts and diamonds are red; spades and clubs keep the text colour.
export const isRedCard = (card: string | null): boolean => card?.[1] === 'h' || card?.[1] === 'd'
