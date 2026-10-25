import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { renderCards, renderReels } from '../hooks/ascii'
import { brier, isGithubPage, isSafeHost, memberPageUrl, testOutcome } from '../hooks/game'

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

test('helpers: safe hosts, test outcomes, Brier', async () => {
  expect(isSafeHost('https://slots.example.workers.dev')).toBe(true)
  expect(isSafeHost('http://localhost:8787')).toBe(true)
  expect(isSafeHost('http://evil.example.com')).toBe(false)
  expect(testOutcome('pnpm test', true)).toBe('fail')
  expect(testOutcome('ls', false)).toBe(null)
  expect(brier([{ pPass: 0.8, passed: true }])?.toFixed(2)).toBe('0.04')
  expect(isGithubPage('https://github.com/login/device')).toBe(true)
  expect(memberPageUrl('https://slots.example.workers.dev/api')).toBe('https://slots.example.workers.dev/#membership')
  expect(memberPageUrl('http://evil.example.com')).toBe(null)
  for (const bad of ['-a Calculator', 'file:///etc/passwd', 'http://github.com/login/device', 'https://github.com.evil.io/x', 'https://user@github.com/', 'javascript:alert(1)', 42]) {
    expect(isGithubPage(bad)).toBe(false)
  }
})

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

const PAIR = { dealt: ['As', 'Ah', '3c', 'Kd', '7s'], bet: 10, made: 'Pair of Aces', contributing: [0, 1] }

/**
 * A fake host answering the routes the mod calls as host/src/app.ts does. Tests change `server` to
 * play out what happens elsewhere (another device drew the hand, a deal landed but its answer was lost).
 */
const fakeHost = (on: On) => {
  const seen: string[] = []
  const opened: string[] = []
  const server = {
    balance: 1000,
    openHand: null as null | typeof PAIR,
    isDown: false,
    isMember: false,
    dealStatus: 200,
    drawStatus: 200,
  }
  const account = () => ({
    login: 'octo',
    balance: server.balance,
    nextLootboxMs: 0,
    openHand: server.openHand,
    membership: { isMember: server.isMember },
    canRefill: server.balance < 10,
  })
  on('http.fetch', (_, e) => {
    const path = new URL(e.url).pathname
    seen.push(`${e.init?.method ?? 'GET'} ${path} ${e.init?.headers?.Authorization ? 'auth' : 'anon'}`)
    const body = JSON.parse(String(e.init?.body ?? '{}'))
    const reply = (status: number, json: unknown) => ({ value: { status, ok: status < 300, headers: {}, text: JSON.stringify(json) } })
    if (server.isDown) return reply(503, { error: 'host down' })
    if (path === '/v1/me') return reply(200, account())
    if (path === '/v1/slots/spin') {
      server.balance += 30 - body.bet
      return reply(200, { grid: GRID, wins: [{ symbol: 'hay', count: 3, amount: 30, cells: [{ reel: 0, row: 0 }] }], win: 30, bet: body.bet, ...account() })
    }
    if (path === '/v1/lootbox') {
      server.balance += 10000
      return reply(200, { prize: { tokens: 10000, label: 'legendary' }, ...account() })
    }
    if (path === '/v1/refill') {
      server.balance += 500
      return reply(200, { refilled: 500, ...account() })
    }
    if (path === '/v1/poker/deal') {
      if (server.dealStatus !== 200) return reply(server.dealStatus, { error: 'a hand is already open: draw first' })
      server.balance -= body.bet
      server.openHand = PAIR
      return reply(200, { dealt: PAIR.dealt, made: PAIR.made, contributing: PAIR.contributing, ...account() })
    }
    if (path === '/v1/poker/draw') {
      if (server.drawStatus !== 200) return reply(server.drawStatus, { error: 'no open hand: deal first' })
      expect(body.holds).toEqual([0, 1])
      server.balance += 30
      server.openHand = null
      return reply(200, { dealt: PAIR.dealt, final: ['As', 'Ah', 'Ac', '2d', '9s'], result: 'Three Aces', contributing: [0, 1, 2], win: 30, ...account() })
    }
    if (path === '/v1/logout') return reply(200, { loggedOut: true })
    return reply(404, { error: 'no route' })
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', (_, e) => (opened.push(e.id), { value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('tool.register', () => ({ value: { tool: 'mcp__terminal-slots__wager' } }))
  on('command.register', () => ({ value: { command: 'slots' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return { seen, server, opened }
}


// Moves a drawing's frame clock (a terminal mount has it; PANE is typed loosely).
const frames = (ui: unknown, ms: number) => (ui as { advance: (ms: number) => Promise<void> }).advance(ms)

// Reads one reel cell from what the reels Client drew: its border colour, label and weight.
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

// Every Text in a drawn tree, with its colour.
const textsOf = (tree: unknown) => {
  const out: { text: string; color?: string }[] = []
  walk(tree, n => {
    if (n.type === 'Text') out.push({ text: (n.children ?? []).join(''), color: n.props?.color as string | undefined })
  })
  return out
}

const signedIn = (on: On) => mock.store(on, { session: 'session-token-for-tests-0123456789' })
const start = ($: { session: { start: (a: { cwd: string; surface: 'terminal'; isInteractive: boolean }) => Promise<unknown> } }) =>
  $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
const label = async (ui: { find: (q: never) => Promise<unknown> }, key: string) =>
  ((await ui.find({ type: 'Button', key } as never)) as { props?: { label?: string } } | undefined)?.props?.label

test('signed out, the pane offers GitHub sign-in on every surface', async ($, on) => {
  mock.store(on)
  fakeHost(on)
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(PANE(surface))
    expect(await ui.find({ type: 'Button', key: 'signin' } as never)).toBeTruthy()
    await ui.unmount()
  }
})

test('signed in: spin lands the server grid; poker auto-holds a paying deal and draws', async ($, on) => {
  signedIn(on)
  const clock = mock.clock(on)
  const host = fakeHost(on)
  await start($)
  expect(host.seen).toContain('GET /v1/me auth')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(PANE(surface))
    expect((await ui.find({ type: 'Text', text: /tokens$/ }))?.text).toMatch(/tokens/)
    expect(await ui.find({ type: 'Button', key: 'support' } as never)).toBeTruthy()
    await ui.unmount()
  }

  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'spin' })
  expect(await ui.find({ type: 'Text', text: /spinning/ })).toBeTruthy()
  await clock.advance(1000)
  expect((await ui.find({ type: 'Text', text: /WIN \+30/ }))?.text).toBe('WIN +30')
  // The reels Client got the server's grid and winning cells; once its frame clock has stopped all
  // five reels, the winning cell's label is drawn bold in gold.
  const reels = (await ui.find({ type: 'Client', key: 'reels' } as never)) as { props?: { props?: { grid?: unknown; cells?: unknown } } }
  expect(reels?.props?.props?.grid).toEqual(GRID)
  expect(reels?.props?.props?.cells).toEqual([{ reel: 0, row: 0 }])
  await frames(ui, 1000)
  expect(cellOf(await ui.drawn({ in: 'reels' } as never), 0, 0)).toMatchObject({ border: 'warning', label: 'HAY', bold: true })
  expect(cellOf(await ui.drawn({ in: 'reels' } as never), 1, 0)).toMatchObject({ border: undefined, label: 'PIG', bold: false })

  await ui.press({ key: 'tab-poker' })
  expect(await ui.find({ type: 'Text', text: /WIN \+30/ })).toBeFalsy() // the slots result stays on its tab
  await ui.press({ key: 'deal' })
  expect(await ui.find({ type: 'Text', text: /You hold: Pair of Aces/ })).toBeTruthy()
  // A paying dealt hand starts held, as on a video poker machine: no presses needed to keep it.
  expect(await label(ui, 'hold-0')).toBe('HELD')
  expect(await label(ui, 'hold-1')).toBe('HELD')
  expect(await label(ui, 'hold-2')).toBe('HOLD')
  await ui.press({ key: 'hold-2' })
  await ui.press({ key: 'hold-2' })
  await ui.press({ key: 'draw' })
  expect((await ui.find({ type: 'Text', text: /Three Aces/ }))?.text).toBe('Three Aces! +30')
  expect(host.seen.filter(s => s.includes('/v1/poker/'))).toEqual(['POST /v1/poker/deal auth', 'POST /v1/poker/draw auth'])
  await ui.unmount()
})

test('a paying hand left open is resumed held after a restart', async ($, on) => {
  signedIn(on)
  const host = fakeHost(on)
  host.server.openHand = PAIR
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'tab-poker' })
  expect(await ui.find({ type: 'Text', text: /Hand resumed\. You hold: Pair of Aces/ })).toBeTruthy()
  expect(await label(ui, 'hold-0')).toBe('HELD')
  expect(await label(ui, 'hold-1')).toBe('HELD')
  await ui.unmount()
})

test('a hand finished elsewhere: DRAW gets 409, the pane follows the server back to DEAL', async ($, on) => {
  signedIn(on)
  const host = fakeHost(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'tab-poker' })
  await ui.press({ key: 'deal' })
  host.server.openHand = null // drawn on another device
  host.server.drawStatus = 409
  await ui.press({ key: 'draw' })
  expect(await ui.find({ type: 'Button', key: 'deal' } as never)).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /finished elsewhere/ })).toBeTruthy()
  await ui.unmount()
})

test('a deal that landed but whose answer was lost: the next DEAL shows the open hand', async ($, on) => {
  signedIn(on)
  const host = fakeHost(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'tab-poker' })
  host.server.openHand = PAIR
  host.server.dealStatus = 409
  await ui.press({ key: 'deal' })
  expect(await ui.find({ type: 'Button', key: 'draw' } as never)).toBeTruthy()
  expect(await label(ui, 'hold-0')).toBe('HELD')
  await ui.unmount()
})

test('a slow spin result never overwrites a newer balance', async ($, on) => {
  signedIn(on)
  const clock = mock.clock(on)
  const host = fakeHost(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'spin' }) // answered now, shown after ~0.9 s with balance 1020
  await ui.press({ key: 'loot' }) // newer: balance 11020
  await clock.advance(1000)
  expect(host.server.balance).toBe(11020)
  expect((await ui.find({ type: 'Text', text: /tokens$/ }))?.text).toBe('11,020 tokens')
  await ui.unmount()
})

test('a double press on SPIN spins once', async ($, on) => {
  signedIn(on)
  const clock = mock.clock(on)
  const host = fakeHost(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'spin' })
  await ui.press({ key: 'spin' })
  await clock.advance(1000)
  expect(host.seen.filter(s => s.includes('/v1/slots/spin'))).toHaveLength(1)
  await ui.unmount()
})

test('signing out clears the open hand', async ($, on) => {
  signedIn(on)
  fakeHost(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'tab-poker' })
  await ui.press({ key: 'deal' })
  await $.command.run({ command: 'slots', args: 'logout' } as never)
  expect(await ui.find({ type: 'Button', key: 'signin' } as never)).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /A♠/ })).toBeFalsy()
  await ui.unmount()
})

test('host unreachable at startup keeps the session and says so', async ($, on) => {
  signedIn(on)
  const host = fakeHost(on)
  host.server.isDown = true
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Text', text: /Can't reach the game host/ })).toBeTruthy()
  // Kept: an outage is not a sign-out, so nothing logged the session out.
  expect(host.seen).not.toContain('POST /v1/logout auth')
  await ui.unmount()
})

test('narrow pane: poker draws inline text, held cards in brackets, red suits red, no wrapping', async ($, on) => {
  signedIn(on)
  fakeHost(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal', 29))
  await ui.press({ key: 'tab-poker' })
  await ui.press({ key: 'deal' })
  const texts = textsOf(await ui.drawn())
  const row = ['[A♠]', '[A♥]', ' 3♣ ', ' K♦ ', ' 7♠ '].map(t => texts.find(x => x.text === t))
  expect(row.map(x => x?.color)).toEqual([undefined, 'error', undefined, 'error', undefined])
  expect(row.map(x => x?.text).join('').length).toBeLessThanOrEqual(29)
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`card colours: hearts and diamonds red, spades and clubs plain (${surface})`, async ($, on) => {
    signedIn(on)
    fakeHost(on)
    await start($)
    const ui = await $.ui.mount(PANE(surface))
    await ui.press({ key: 'tab-poker' })
    await ui.press({ key: 'deal' })
    const texts = textsOf(await ui.drawn())
    const colourOf = (suit: string) => texts.find(x => x.text.includes(suit))?.color
    expect(colourOf('♥')).toBe('error')
    expect(colourOf('♦')).toBe('error')
    expect(colourOf('♠')).toBe(undefined)
    expect(colourOf('♣')).toBe(undefined)
    await ui.unmount()
  })
}

test('the band above the prompt shows the balance and toggles the pane', async ($, on) => {
  signedIn(on)
  const { opened } = fakeHost(on)
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount(BAND(surface))
    expect(await band.find({ type: 'Text', text: /1,000 tokens/ })).toBeTruthy()
    expect(await label(band, 'slots-toggle')).toBe('Hide')
    await band.press({ key: 'slots-toggle' })
    expect(await label(band, 'slots-toggle')).toBe('Show')
    await band.press({ key: 'slots-toggle' })
    expect(await label(band, 'slots-toggle')).toBe('Hide')
    await band.unmount()
  }
  expect(opened.filter(id => id === 'slots').length).toBeGreaterThanOrEqual(2)
})

test('broke: the pane offers a free refill beside the support link', async ($, on) => {
  signedIn(on)
  const host = fakeHost(on)
  host.server.balance = 4
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Button', key: 'support-broke' } as never)).toBeTruthy()
  await ui.press({ key: 'refill' })
  expect((await ui.find({ type: 'Text', text: /Refilled/ }))?.text).toMatch(/\+500/)
  expect(await ui.find({ type: 'Button', key: 'refill' } as never)).toBeFalsy()
  expect(host.seen).toContain('POST /v1/refill auth')
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`clicking a card face holds or releases it, like its HOLD button (${surface})`, async ($, on) => {
    signedIn(on)
    fakeHost(on)
    await start($)
    const ui = await $.ui.mount(PANE(surface))
    await ui.press({ key: 'tab-poker' })
    await ui.press({ key: 'deal' })
    expect(await label(ui, 'hold-2')).toBe('HOLD')
    await ui.press({ key: 'card-2' })
    expect(await label(ui, 'hold-2')).toBe('HELD')
    await ui.press({ key: 'card-0' }) // auto-held pair card: releases it
    expect(await label(ui, 'hold-0')).toBe('HOLD')
    await ui.unmount()
  })
}

test('the reels spin on the frame clock, then stop left to right before the win lights up', async ($, on) => {
  signedIn(on)
  const clock = mock.clock(on)
  fakeHost(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'spin' })
  const before = cellOf(await ui.drawn({ in: 'reels' } as never), 2, 1).glyph
  await frames(ui, 50)
  const after = cellOf(await ui.drawn({ in: 'reels' } as never), 2, 1).glyph
  expect(after).not.toBe(before) // a blur of symbols, one frame to the next
  expect(cellOf(await ui.drawn({ in: 'reels' } as never), 2, 1).border).toBe('subtle')

  await clock.advance(1000) // the result lands
  await frames(ui, 150) // first reel stopped, last still spinning
  let tree = await ui.drawn({ in: 'reels' } as never)
  expect(cellOf(tree, 0, 0)).toMatchObject({ label: 'HAY', border: undefined })
  expect(cellOf(tree, 4, 0).border).toBe('subtle')

  await frames(ui, 600) // all stopped: now the win is gold
  tree = await ui.drawn({ in: 'reels' } as never)
  expect(cellOf(tree, 4, 0).border).toBe(undefined)
  expect(cellOf(tree, 0, 0)).toMatchObject({ border: 'warning', bold: true })
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a supporter's name is drawn in rainbow letters with a gold star (${surface})`, async ($, on) => {
    signedIn(on)
    const host = fakeHost(on)
    host.server.isMember = true
    await start($)
    const ui = await $.ui.mount(PANE(surface))
    const texts = textsOf(await ui.drawn())
    const i = texts.findIndex(t => t.text === 'o')
    const letters = texts.slice(i, i + 4)
    expect(letters.map(t => t.text).join('')).toBe('octo')
    expect(new Set(letters.map(t => t.color)).size).toBe(4) // each letter its own colour
    expect(texts.find(t => t.text.includes('★'))?.color).toBe('warning')
    // Inline, not stacked: every letter sits inside one Text that holds the whole name.
    let parent: Node | undefined
    walk(await ui.drawn(), n => {
      if (n.type === 'Text' && (n.children ?? []).filter(c => (c as Node)?.type === 'Text').length >= 4) parent = n
    })
    expect(textsOf(parent).slice(1).map(t => t.text).join('')).toMatch(/^octo/)
    await ui.unmount()
  })
}

test("a non-supporter's name stays plain, with no star", async ($, on) => {
  signedIn(on)
  fakeHost(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  const texts = textsOf(await ui.drawn())
  expect(texts.some(t => t.text.includes('octo'))).toBe(true)
  expect(texts.some(t => t.text.includes('★') || t.text.includes('⭐'))).toBe(false)
  await ui.unmount()
})

test('after I\'m Rich, a non-supporter sees a support nudge until their next action', async ($, on) => {
  signedIn(on)
  const clock = mock.clock(on)
  fakeHost(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Button', key: 'support-nudge' } as never)).toBeFalsy()
  await ui.press({ key: 'loot' })
  expect(await ui.find({ type: 'Button', key: 'support-nudge' } as never)).toBeTruthy()
  await ui.press({ key: 'spin' })
  await clock.advance(1000)
  expect(await ui.find({ type: 'Button', key: 'support-nudge' } as never)).toBeFalsy()
  await ui.unmount()
})

test("a supporter never sees the nudge after I'm Rich", async ($, on) => {
  signedIn(on)
  const host = fakeHost(on)
  host.server.isMember = true
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'loot' })
  expect(await ui.find({ type: 'Button', key: 'support-nudge' } as never)).toBeFalsy()
  await ui.unmount()
})

test("can't spin a bet larger than the balance: SPIN turns to plain text with the reason", async ($, on) => {
  signedIn(on)
  const host = fakeHost(on)
  host.server.balance = 17
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Button', key: 'spin' } as never)).toBeTruthy() // bet 10 ≤ 17
  await ui.press({ key: 'slot-bet' }) // → 20
  expect(await ui.find({ type: 'Button', key: 'spin' } as never)).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /Bet 20 is more than your 17 tokens/ })).toBeTruthy()
  await ui.press({ key: 'slot-bet' }) // 50
  await ui.press({ key: 'slot-bet' }) // 100
  await ui.press({ key: 'slot-bet' }) // back to 10
  expect(await ui.find({ type: 'Button', key: 'spin' } as never)).toBeTruthy()
  expect(host.seen.filter(x => x.includes('/v1/slots/spin'))).toHaveLength(0)
  await ui.unmount()
})

test("can't deal a bet larger than the balance", async ($, on) => {
  signedIn(on)
  const host = fakeHost(on)
  host.server.balance = 7
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  await ui.press({ key: 'tab-poker' }) // poker bet 10 > 7
  expect(await ui.find({ type: 'Button', key: 'deal' } as never)).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /Bet 10 is more than your 7 tokens/ })).toBeTruthy()
  await ui.unmount()
})

test("Claude's calibration line stays hidden until Claude has made a prediction", async ($, on) => {
  signedIn(on)
  fakeHost(on)
  await start($)
  const ui = await $.ui.mount(PANE('terminal'))
  expect(await ui.find({ type: 'Text', text: /calibration|Brier/ })).toBeFalsy()
  await ui.unmount()
})
