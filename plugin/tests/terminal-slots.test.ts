import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { cardText, renderCards, renderReels } from '../hooks/ascii'
import { brier, isGithubPage, testOutcome } from '../hooks/game'
import { BET, BONUS_DEAL_ORDINAL, BONUS_SPIN_WIN, bonusDeal, bonusSpin, dealFrom, drawFrom, milestoneOf, spinFrom } from '../hooks/local'
import { royalDraw, scoreDealt } from '../hooks/engine/slots-engine.js'
import { isPomo, newPomo, nextPomo, progressBar } from '../hooks/pomodoro'

const GRID = [
  ['hay', 'star', 'lantern'],
  ['pig', 'scatter', 'hay'],
  ['hay', 'apple', 'horseshoe'],
  ['tractor', 'star', 'horseshoe'],
  ['lantern', 'hay', 'apple'],
]

test('renderers degrade with the pane width', async () => {
  expect(renderReels(GRID, 60)).toHaveLength(7)
  expect(renderReels(GRID, 60)[1]).toContain('HAY')
  expect(renderReels(GRID, 30)[1]).not.toContain('HAY')
  expect(renderReels(GRID, 20)).toHaveLength(3)
  expect(renderCards(['As', 'Th', '3c', 'Kd', 'Qs'], 60, [true])).toHaveLength(6)
  expect(renderCards(['As', 'Th', '3c', 'Kd', 'Qs'], 34)[1]).toContain('10♥')
  expect(renderCards(['As', 'Th', '3c', 'Kd', 'Qs'], 20, [true])[0]).toBe('[A♠] 10♥  3♣  K♦  Q♠ ')
})

test('helpers: test outcomes, Brier, GitHub-only links', async () => {
  expect(testOutcome('pnpm test', true)).toBe('fail')
  expect(testOutcome('ls', false)).toBe(null)
  expect(brier([{ pPass: 0.8, passed: true }])?.toFixed(2)).toBe('0.04')
  expect(isGithubPage('https://github.com/sponsors/altoption')).toBe(true)
  for (const bad of ['-a Calculator', 'file:///etc/passwd', 'http://github.com/x', 'https://github.com.evil.io/x', 'https://user@github.com/', 42]) {
    expect(isGithubPage(bad)).toBe(false)
  }
})

// ---- the games, on this machine ---------------------------------------------------------------------

// The first seed of s0, s1, … whose deal passes `ok`.
const seedWhere = (ok: (d: ReturnType<typeof dealFrom>) => boolean) => {
  for (let i = 0; i < 5000; i++) if (ok(dealFrom(`s${i}`))) return `s${i}`
  throw new Error('no such seed')
}

test('games are a function of their seed', async () => {
  expect(spinFrom('abc')).toEqual(spinFrom('abc'))
  const seed = seedWhere(d => d.made !== null)
  const d = dealFrom(seed)
  expect(d.contributing.length).toBeGreaterThan(0)
  expect(drawFrom(seed, d.contributing)).toEqual(drawFrom(seed, d.contributing))
  expect(drawFrom(seed, [0, 1, 2, 3, 4]).final).toEqual(d.dealt) // holding everything keeps the hand
})

test('a bonus spin pays 10× the bet or more; a bonus deal is Three of a Kind or better', async () => {
  for (let i = 0; i < 10; i++) {
    expect(bonusSpin().win).toBeGreaterThanOrEqual(BONUS_SPIN_WIN)
    expect(bonusDeal().ordinal).toBeGreaterThanOrEqual(BONUS_DEAL_ORDINAL)
  }
  // Bounded: with one try it is just a normal play.
  let n = 0
  bonusSpin(() => `t${n++}`, 1)
  expect(n).toBe(1)
})

test('milestones: commits and PRs that ran, one command at a time, never a dry run', async () => {
  expect(milestoneOf('git commit -m "x"')).toBe('commit')
  expect(milestoneOf('git add -A && git commit -q -m "feat: x" && git push')).toBe('commit')
  expect(milestoneOf('git -C repo commit -m x')).toBe('commit')
  expect(milestoneOf('gh pr create --title t --body b')).toBe('pr')
  expect(milestoneOf('git commit -m x && gh pr create -f')).toBe('pr')
  expect(milestoneOf('git commit --dry-run')).toBe(null)
  expect(milestoneOf('git log --oneline')).toBe(null)
  expect(milestoneOf('echo git commit')).toBe(null)
  expect(milestoneOf('gh pr list')).toBe(null)
})

// ---- the pane -----------------------------------------------------------------------------------------

const PANE = (surface: 'terminal' | 'desktop', bodyColumns = 60) =>
  ({
    plugin: 'terminal-slots',
    component: 'Pane',
    requestId: 'slots',
    surface,
    props: { title: 'Terminal Slots', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  }) as never

const BAND = (surface: 'terminal' | 'desktop') =>
  ({
    plugin: 'terminal-slots',
    component: 'AbovePrompt',
    surface,
    props: { hasSurvey: false, isWorking: false, maxRows: 10, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  }) as never

/**
 * Stands in for Claude Code beneath the plugin. Any network call fails the test: the plugin has none.
 * `tools.isError` sets how the next tool call ends.
 */
const engine = (on: On) => {
  const toasts: string[] = []
  const opened: string[] = []
  const launched: string[][] = []
  const tools = { isError: false }
  on('http.fetch', e => {
    throw new Error(`the plugin made a network call: ${JSON.stringify(e)}`)
  })
  on('ui.toast', (_, e) => (toasts.push(JSON.stringify(e)), { value: undefined }))
  on('ui.open', (_, e) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('process.run', (_, e) => (launched.push([...e.argv]), { value: { exitCode: 0, stdout: '', stderr: '' } } as never))
  on('tool.register', () => ({ value: { tool: 'mcp__terminal-slots__wager' } }))
  on('command.register', () => ({ value: { command: 'slots' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {}, ...(tools.isError ? { isError: true } : {}) }) as never)
  on('turn.complete', () => ({ text: '' }))
  return { toasts, opened, launched, tools }
}

// Card text as the narrow pane draws it → card code.
const CODE = new Map([...'23456789TJQKA'].flatMap(r => [...'shdc'].map(u => [cardText(r + u), r + u] as const)))

// The five cards a narrow (< 30 columns) pane shows, and which are bracketed (held, or paying once drawn).
const shownCards = async (ui: { drawn: () => Promise<unknown> }) => {
  const row = textsOf(await ui.drawn()).filter(x => /^[ [].{2,3}[ \]]$/.test(x.text) && CODE.has(x.text.slice(1, -1)))
  return { cards: row.map(x => CODE.get(x.text.slice(1, -1))!), marked: row.flatMap((x, i) => (x.text.startsWith('[') ? [i] : [])), row }
}

// Earns a bonus the way Claude does: a commit that ran.
const commit = ($: any) => $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' })

const start = ($: { session: { start: (a: { cwd: string; surface: 'terminal'; isInteractive: boolean }) => Promise<unknown> } }) =>
  $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
const label = async (ui: { find: (q: never) => Promise<unknown> }, key: string) =>
  ((await ui.find({ type: 'Button', key } as never)) as { props?: { label?: string } } | undefined)?.props?.label
const text = async (ui: { find: (q: never) => Promise<unknown> }, re: RegExp) =>
  ((await ui.find({ type: 'Text', text: re } as never)) as { text?: string } | undefined)?.text

// Moves a drawing's frame clock (a terminal mount has it; PANE is typed loosely).
const frames = (ui: unknown, ms: number) => (ui as { advance: (ms: number) => Promise<void> }).advance(ms)

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const walk = (n: unknown, fn: (n: Node) => void) => {
  if (!n || typeof n !== 'object') return
  fn(n as Node)
  for (const c of (n as Node).children ?? []) walk(c, fn)
}
const cellOf = (tree: unknown, reel: number, row: number) => {
  let cell: Node | undefined
  walk(tree, n => {
    if (n.props?.key === `cell-${reel}-${row}`) cell = n
  })
  const texts = (cell?.children ?? []) as Node[]
  const label = texts[1]
  return {
    border: cell?.props?.borderColor as string | undefined,
    glyph: (texts[0]?.children ?? [])[0],
    label: label ? (label.children ?? [])[0] : undefined,
    bold: label?.props?.bold,
  }
}
const textsOf = (tree: unknown) => {
  const out: { text: string; color?: string }[] = []
  walk(tree, n => {
    if (n.type === 'Text') out.push({ text: (n.children ?? []).join(''), color: n.props?.color as string | undefined })
  })
  return out
}

// Claude ending a main-loop turn after `tools` tool calls.
const claudeTurn = async ($: any, tools: number, extra: Record<string, unknown> = {}) => {
  for (let i = 0; i < tools; i++) await $.tool.call({ tool: 'Read', file_path: '/x', ...('agentId' in extra ? { agentId: extra.agentId } : {}) })
  await $.turn.complete({ turnId: 't', reason: 'answer', answer: 'done', durationMs: 1000, isAborted: extra.reason === 'aborted', ...extra })
  // The play starts after the turn's result has gone on: let it land.
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

test('no sign-in: the pane plays straight away on every surface, and nothing to sign in to', async ($, on) => {
  mock.store(on, { session: 'an-old-game-server-token' })
  engine(on)
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(PANE(surface))
    expect(await ui.find({ type: 'Button', key: 'spin' } as never)).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'signin' } as never)).toBeFalsy()
    expect(await text(ui, /tokens/)).toBeFalsy()
    await ui.unmount()
  }
})

test('SPIN lands a local spin and scores it; a double press spins once', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  engine(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  for (let n = 1; n <= 3; n++) {
    await ui.press({ key: 'spin' })
    await ui.press({ key: 'spin' })
    expect(await text(ui, /spinning/)).toBeTruthy()
    await clock.advance(1000)
    const reels = (await ui.find({ type: 'Client', key: 'reels' } as never)) as { props?: { props?: { cells?: unknown[] } } }
    const message = (await text(ui, /^WIN \d+$|^No win\.$/)) ?? ''
    // A win lights cells; no win lights none.
    expect(message.startsWith('WIN')).toBe((reels?.props?.props?.cells ?? []).length > 0)
    expect(await text(ui, /plays ·/)).toMatch(new RegExp(`^${n} plays ·`)) // two presses, one play
  }
  await ui.unmount()
})

test('poker: a paying deal starts held, holds toggle, DRAW scores the cards it shows', async ($, on) => {
  mock.store(on)
  engine(on)
  await start($)
  const narrow = await $.ui.mount(PANE('terminal', 29))
  const wide = await $.ui.mount(PANE('desktop'))
  await wide.press({ key: 'tab-poker' })
  for (let round = 0; round < 5; round++) {
    await wide.press({ key: 'deal' })
    const dealt = await shownCards(narrow)
    expect(dealt.cards).toHaveLength(5)
    const made = scoreDealt(royalDraw, dealt.cards, BET)
    // Exactly the paying cards start held.
    expect(dealt.marked).toEqual(made.win > 0 ? made.result.contributing : [])
    if (made.win > 0) expect(await text(wide, /You hold:/)).toMatch(new RegExp(`You hold: ${made.result.label}`))
    // Clicking a face flips its hold, like its HOLD button; flipped back, the paying cards stay held.
    const was = dealt.marked.includes(0) ? 'HELD' : 'HOLD'
    await wide.press({ key: 'card-0' })
    expect(await label(wide, 'hold-0')).toBe(was === 'HELD' ? 'HOLD' : 'HELD')
    await wide.press({ key: 'hold-0' })
    expect(await label(wide, 'hold-0')).toBe(was)
    await wide.press({ key: 'draw' })
    const final = await shownCards(narrow)
    for (const i of dealt.marked) expect(final.cards[i]).toBe(dealt.cards[i]) // held cards stay
    const scored = scoreDealt(royalDraw, final.cards, BET)
    const name = scored.result.label
    expect(await text(wide, new RegExp(`^${name}`))).toBe(scored.win > 0 ? `${name}! WIN ${Math.floor(scored.win)}` : `${name}. No win.`)
  }
  await narrow.unmount()
  await wide.unmount()
})

test("a busy Claude turn spins on the Slots tab; a short one, a subagent's or an interrupted one doesn't", async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  engine(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  await claudeTurn($, 2)
  expect(await text(ui, /spinning/)).toBeFalsy()
  await claudeTurn($, 5, { agentId: 'sub-1' })
  expect(await text(ui, /spinning/)).toBeFalsy()
  // A subagent's (or a compaction fork's) tools inside the main turn don't count towards it.
  for (let i = 0; i < 5; i++) await ($ as any).tool.call({ tool: 'Read', file_path: '/x', agentId: 'fork-1' })
  await claudeTurn($, 1)
  expect(await text(ui, /spinning/)).toBeFalsy()
  await claudeTurn($, 5, { reason: 'aborted' })
  await claudeTurn($, 1) // the aborted turn's calls don't carry over
  expect(await text(ui, /spinning/)).toBeFalsy()
  await claudeTurn($, 3)
  expect(await text(ui, /spinning/)).toBeTruthy()
  await clock.advance(1000)
  expect(await text(ui, /^Claude spun: /)).toBeTruthy()
  await ui.unmount()
})

test("on the Poker tab Claude deals and draws after 4 s, unless the player takes the hand", async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  engine(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'tab-poker' })
  await claudeTurn($, 3)
  expect(await text(ui, /Claude dealt\./)).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'draw' } as never)).toBeTruthy()
  await clock.advance(4000)
  expect(await ui.find({ type: 'Button', key: 'deal' } as never)).toBeTruthy() // drawn by itself

  await claudeTurn($, 3)
  await ui.drawn() // let Claude's deal draw before the player reaches for it
  await ui.press({ key: 'hold-2' }) // the player takes over
  await clock.advance(10_000)
  expect(await ui.find({ type: 'Button', key: 'draw' } as never)).toBeTruthy() // still waiting for them
  await claudeTurn($, 3) // mid-hand: Claude's turn doesn't deal over it
  expect(await ui.find({ type: 'Button', key: 'draw' } as never)).toBeTruthy()
  await ui.unmount()
})

test("Claude's auto-draw never acts on a later hand", async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  engine(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'tab-poker' })
  await claudeTurn($, 3)
  await clock.advance(1000)
  await ui.press({ key: 'draw' }) // the player draws Claude's hand early
  await ui.press({ key: 'deal' }) // and deals their own
  await clock.advance(5000) // the old 4 s timer's time passes
  expect(await ui.find({ type: 'Button', key: 'draw' } as never)).toBeTruthy() // their hand is untouched
  await ui.unmount()
})

test('nothing plays on the Pomodoro tab or with the pane hidden', async ($, on) => {
  mock.store(on)
  engine(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'tab-pomodoro' })
  await claudeTurn($, 5)
  await ui.press({ key: 'tab-slots' })
  expect(await text(ui, /spinning|Claude spun/)).toBeFalsy()
  await $.command.run({ command: 'slots', args: '' } as never) // hide
  await claudeTurn($, 5)
  expect(await text(ui, /spinning|Claude spun/)).toBeFalsy()
  await ui.unmount()
})

test('a commit earns a bonus: the next spin wins big, once, and a PR outranks it', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  const host = engine(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  await ($ as any).tool.call({ tool: 'Bash', command: 'git add -A && git commit -m "feat: x"' })
  expect(host.toasts.some(t => /Committed! Your next spin or deal is a 🏆 bonus/.test(t))).toBe(true)
  expect(await text(ui, /next play is a bonus/)).toBeTruthy()
  const band = await $.ui.mount(BAND('terminal'))
  expect(await band.find({ type: 'Text', text: /bonus ready/ })).toBeTruthy()
  await band.unmount()
  await ($ as any).tool.call({ tool: 'Bash', command: 'git commit -m again' }) // one bonus waits at a time
  expect(host.toasts.filter(t => /Committed!/.test(t))).toHaveLength(1)
  await ($ as any).tool.call({ tool: 'Bash', command: 'gh pr create -f' })
  expect(host.toasts.some(t => /Pull request opened!/.test(t))).toBe(true)

  await ui.press({ key: 'spin' })
  expect(await text(ui, /bonus spin/)).toBeTruthy()
  await clock.advance(1000)
  const won = Number((await text(ui, /^🏆 Bonus! WIN \d+$/))?.match(/\d+/)?.[0])
  expect(won).toBeGreaterThanOrEqual(BONUS_SPIN_WIN)
  expect(await text(ui, /next play is a bonus/)).toBeFalsy()
  await ui.unmount()
})

test("a failed command earns nothing; tests passing again after a failure do; the bonus survives a reload", async ($, on) => {
  mock.store(on)
  const host = engine(on)
  await start($)
  host.tools.isError = true
  await ($ as any).tool.call({ tool: 'Bash', command: 'git commit -m x' })
  await ($ as any).tool.call({ tool: 'Bash', command: 'pnpm test' })
  host.tools.isError = false
  expect(host.toasts.some(t => /bonus/.test(t))).toBe(false)
  await ($ as any).tool.call({ tool: 'Bash', command: 'pnpm test' })
  expect(host.toasts.some(t => /Tests pass again!/.test(t))).toBe(true)
  await start($) // a reload
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'tab-poker' })
  expect(await text(ui, /next play is a bonus/)).toBeTruthy()
  await ui.press({ key: 'deal' })
  expect(await text(ui, /^🏆 Bonus deal!/)).toBeTruthy()
  await ui.unmount()
})

test('💖 Sponsor opens the GitHub Sponsors page and nothing else', async ($, on) => {
  mock.store(on)
  const host = engine(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'sponsor' })
  expect(host.launched).toEqual([['open', 'https://github.com/sponsors/altoption']])
  await ui.unmount()
})

test('narrow pane: poker draws inline text, held cards in brackets, red suits red, no wrapping', async ($, on) => {
  mock.store(on)
  engine(on)
  await start($)
  await commit($) // a bonus deal: Three of a Kind or better, so some cards are held
  const ui = await $.ui.mount(PANE('terminal', 29))
  await ui.press({ key: 'tab-poker' })
  await ui.press({ key: 'deal' })
  const texts = textsOf(await ui.drawn())
  const row = texts.filter(x => /^[ [][0-9AKQJT]{1,2}[♠♥♦♣][ \]]$/.test(x.text))
  expect(row).toHaveLength(5)
  for (const x of row) expect(x.color).toBe(/[♥♦]/.test(x.text) ? 'error' : undefined)
  expect(row.some(x => x.text.startsWith('['))).toBe(true)
  expect(row.map(x => x.text).join('').length).toBeLessThanOrEqual(29)
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`card colours: hearts and diamonds red, spades and clubs plain (${surface})`, async ($, on) => {
    mock.store(on)
    engine(on)
    await start($)
    const ui = await $.ui.mount(PANE(surface))
    await ui.press({ key: 'tab-poker' })
    await ui.press({ key: 'deal' })
    for (const t of textsOf(await ui.drawn()).filter(x => /[♠♥♦♣]/.test(x.text) && x.text.length < 40)) {
      expect(t.color).toBe(/[♥♦]/.test(t.text) ? 'error' : undefined)
    }
    await ui.unmount()
  })
}

test('the band above the prompt toggles the pane', async ($, on) => {
  mock.store(on)
  const { opened } = engine(on)
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount(BAND(surface))
    expect(await label(band, 'slots-toggle')).toBe('Hide')
    await band.press({ key: 'slots-toggle' })
    expect(await label(band, 'slots-toggle')).toBe('Show')
    await band.press({ key: 'slots-toggle' })
    expect(await label(band, 'slots-toggle')).toBe('Hide')
    await band.unmount()
  }
  expect(opened.filter(id => id === 'slots').length).toBeGreaterThanOrEqual(2)
})

test('the reels spin on the frame clock, then stop left to right before the win lights up', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  engine(on)
  await start($)
  await commit($) // a bonus spin: sure to win
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'spin' })
  const before = cellOf(await ui.drawn({ in: 'reels' } as never), 2, 1).glyph
  await frames(ui, 50)
  expect(cellOf(await ui.drawn({ in: 'reels' } as never), 2, 1).glyph).not.toBe(before)
  expect(cellOf(await ui.drawn({ in: 'reels' } as never), 2, 1).border).toBe('subtle')

  await clock.advance(1000) // the result lands
  const reels = (await ui.find({ type: 'Client', key: 'reels' } as never)) as { props?: { props?: { cells: { reel: number; row: number }[] } } }
  const win = reels!.props!.props!.cells[0]!
  await frames(ui, 150) // first reel stopped, last still spinning
  let tree = await ui.drawn({ in: 'reels' } as never)
  expect(cellOf(tree, 0, 0).border).not.toBe('subtle')
  expect(cellOf(tree, 4, 0).border).toBe('subtle')

  await frames(ui, 600) // all stopped: now the win is gold
  tree = await ui.drawn({ in: 'reels' } as never)
  expect(cellOf(tree, win.reel, win.row)).toMatchObject({ border: 'warning', bold: true })
  await ui.unmount()
})

test("Claude's calibration line stays hidden until Claude has made a prediction", async ($, on) => {
  mock.store(on)
  engine(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Text', text: /calibration|Brier/ })).toBeFalsy()
  await ui.unmount()
})

const MIN = 60_000
test('pomodoro rules: four focus sessions earn the long break; a skipped one counts for nothing', async () => {
  let p = newPomo()
  for (let i = 1; i <= 3; i++) {
    p = nextPomo(p, 0, true)
    expect([p.phase, p.round, p.today]).toEqual(['short', i, i])
    p = nextPomo(p, 0, true)
    expect(p.phase).toBe('focus')
  }
  expect(nextPomo(p, 0, false)).toMatchObject({ phase: 'short', round: 3, today: 3 }) // skipped
  p = nextPomo(p, 0, true)
  expect([p.phase, p.round, p.leftMs]).toEqual(['long', 4, 15 * MIN])
  p = nextPomo(p, 0, true)
  expect([p.phase, p.round, p.today]).toEqual(['focus', 0, 4])
  // A new day starts the count again.
  expect(nextPomo(p, 2 * 24 * 60 * MIN, true).today).toBe(1)
  expect(progressBar({ ...newPomo(), endsAt: 12.5 * MIN }, 0, 10)).toBe('█████░░░░░')
  for (const bad of [null, 42, {}, { ...newPomo(), phase: 'nap' }, { ...newPomo(), leftMs: -1 }, { ...newPomo(), endsAt: 'soon' }]) {
    expect(isPomo(bad)).toBe(false)
  }
})

test('the Pomodoro tab works signed out: start, pause, resume, and a toast when focus ends', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  const host = engine(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'tab-pomodoro' })
  expect(await text(ui, /Focus$/)).toBe('🍅 Focus')
  expect(await text(ui, /^\d+:\d\d$/)).toBe('25:00')
  await ui.press({ key: 'pomo-start' })
  await clock.advance(MIN)
  expect(await text(ui, /^\d+:\d\d$/)).toBe('24:00')
  const band = await $.ui.mount(BAND('terminal'))
  expect(await band.find({ type: 'Text', text: /🍅 24:00/ })).toBeTruthy()
  await band.unmount()

  await ui.press({ key: 'pomo-pause' })
  await clock.advance(10 * MIN)
  expect(await text(ui, /^\d+:\d\d$/)).toBe('24:00') // paused: no time passes
  expect(await label(ui, 'pomo-start')).toBe('Resume')
  await ui.press({ key: 'pomo-start' })
  await clock.advance(24 * MIN)
  expect(host.toasts.some(t => /Pomodoro done! Take a 5-minute break/.test(t))).toBe(true)
  expect(await text(ui, /break$/)).toBe('☕ Short break')
  expect(await text(ui, /^\d+:\d\d$/)).toBe('5:00')
  expect(await text(ui, /1 today/)).toBeTruthy()
  expect(await label(ui, 'pomo-start')).toBe('Start') // the break waits for the player

  await ui.press({ key: 'pomo-skip' })
  expect(await text(ui, /Focus$/)).toBe('🍅 Focus')
  await ui.press({ key: 'pomo-start' })
  await clock.advance(3 * MIN)
  await ui.press({ key: 'pomo-reset' })
  expect(await text(ui, /^\d+:\d\d$/)).toBe('25:00')
  expect(await label(ui, 'pomo-start')).toBe('Start')
  await clock.advance(30 * MIN)
  expect(host.toasts.filter(t => /Pomodoro done/.test(t))).toHaveLength(1) // a reset timer never fires
  await ui.unmount()
})

test('a running pomodoro carries on after a restart', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on, { pomo: { ...newPomo(), endsAt: 10 * MIN } })
  const host = engine(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'tab-pomodoro' })
  expect(await text(ui, /^\d+:\d\d$/)).toBe('10:00')
  await clock.advance(10 * MIN)
  expect(host.toasts.some(t => /Pomodoro done!/.test(t))).toBe(true)
  await ui.unmount()
})

test('a pomodoro that ended while Claude Code was closed is finished, and says so', async ($, on) => {
  const clock = mock.clock(on)
  await clock.advance(60 * MIN)
  mock.store(on, { pomo: { ...newPomo(), endsAt: 5 * MIN } })
  const host = engine(on)
  await start($)
  expect(host.toasts.some(t => /Pomodoro done \(while you were away\)/.test(t))).toBe(true)
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'tab-pomodoro' })
  expect(await text(ui, /break$/)).toBe('☕ Short break')
  await ui.unmount()
})
