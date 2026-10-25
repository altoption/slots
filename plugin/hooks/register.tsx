import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Bonus, CasinoView, Pomo } from '../types'
import { cardFace, cardText, isRedCard, randomGrid, renderReels } from './ascii'
import { brier, isGithubPage, newCalibration, testOutcome, type Calibration } from './game'
import { bonusDeal, bonusSpin, dealFrom, drawFrom, milestoneOf, newSeed, spinFrom, type Deal, type Spin } from './local'
import {
  clockText, dayOf, isPomo, isRunning, newPomo, nextPomo, PHASE_LABEL, pausePomo, POMO_MS, pomoLeft, progressBar, resetPomo, ROUND, startPomo,
} from './pomodoro'

const PANE = 'slots'
const WAGER = 'mcp__terminal-slots__wager'
const BIG_WIN = 200 // points: 20× the bet
const RED = 'error' // the theme's red: hearts and diamonds
// A Claude turn that used at least this many tools plays once on the open tab.
const TOOLS_PER_PLAY = 3
const AUTO_DRAW_MS = 4000

// Bump the tag when CasinoView's fields change: a reload declines the old value.
const NEW_SLOTS = (): CasinoView['slots'] => ({ grid: randomGrid(Math.random), win: 0, cells: [], isSpinning: false, isBonus: false, message: '' })
const NEW_POKER = (): CasinoView['poker'] => ({
  cards: [null, null, null, null, null],
  held: [false, false, false, false, false],
  winning: [],
  phase: 'idle',
  handId: '',
  touched: false,
  isBonus: false,
  result: '',
  win: 0,
  message: '',
})
const NEW_STATS = (): CasinoView['stats'] => ({ plays: 0, points: 0, best: 0 })
const view = atom(
  { plugin: 'terminal-slots', key: 'view' } as const,
  {
    tab: 'slots',
    message: '',
    isPaneOpen: false,
    now: 0,
    bonus: null,
    stats: NEW_STATS(),
    slots: NEW_SLOTS(),
    poker: NEW_POKER(),
    pomo: newPomo(),
    calib: { settled: 0, brier: null, pending: null },
  } as CasinoView,
  { shape: 'view-11' },
)

async function say($: EngineInterface, message: string): Promise<void> {
  await update($, view, v => ({ ...v, message }))
}

// ---- points (local, for fun) -----------------------------------------------------------------------

const isStats = (x: unknown): x is CasinoView['stats'] => {
  const s = x as CasinoView['stats']
  return typeof s === 'object' && s !== null && [s.plays, s.points, s.best].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)
}

async function score($: EngineInterface, win: number): Promise<void> {
  let stats = NEW_STATS()
  await update($, view, v => {
    stats = { plays: v.stats.plays + 1, points: v.stats.points + win, best: Math.max(v.stats.best, win) }
    return { ...v, stats }
  })
  await $.store.set('stats', stats)
}

// ---- bonus: a milestone makes the next play a winner -----------------------------------------------

const BONUS_RANK: Record<Bonus, number> = { tests: 1, commit: 2, pr: 3 }
const BONUS_TOAST: Record<Bonus, string> = {
  tests: '✅ Tests pass again! Your next spin or deal is a 🏆 bonus.',
  commit: '📦 Committed! Your next spin or deal is a 🏆 bonus.',
  pr: '🚀 Pull request opened! Your next spin or deal is a 🏆 bonus.',
}

const isBonus = (x: unknown): x is Bonus => typeof x === 'string' && x in BONUS_RANK

// One bonus waits at a time; a bigger milestone upgrades it. Kept in the store, so a reload keeps it.
async function earnBonus($: EngineInterface, kind: Bonus): Promise<void> {
  const held = (await $.store.get('bonus')) as unknown
  if (isBonus(held) && BONUS_RANK[held] >= BONUS_RANK[kind]) return
  await $.store.set('bonus', kind)
  await update($, view, v => ({ ...v, bonus: kind }))
  $.ui.toast(BONUS_TOAST[kind])
}

// Takes the waiting bonus, if any, for the play about to happen.
async function takeBonus($: EngineInterface): Promise<boolean> {
  if (!isBonus(await $.store.get('bonus'))) return false
  await $.store.delete('bonus')
  await update($, view, v => ({ ...v, bonus: null }))
  return true
}

// ---- games -----------------------------------------------------------------------------------------

// Set synchronously, before any await, so a double press (or Claude and the player at once) plays once.
let inFlight = false

async function spin($: EngineInterface, byClaude = false): Promise<void> {
  if (inFlight) return
  inFlight = true
  const isBonusPlay = await takeBonus($)
  const result = isBonusPlay ? bonusSpin() : spinFrom(newSeed())
  await update($, view, v => ({ ...v, slots: { ...v.slots, isSpinning: true, cells: [], win: 0, isBonus: isBonusPlay, message: '' } }))
  // Let the reels run ~0.9 s so the result lands like a spin, not a flicker.
  $.clock.after(900, () => void landSpin($, result, isBonusPlay, byClaude))
}

// The reels Client animates on its own clock; this only hands it the result.
async function landSpin($: EngineInterface, r: Spin, isBonusPlay: boolean, byClaude: boolean): Promise<void> {
  inFlight = false
  const who = isBonusPlay ? '🏆 Bonus! ' : byClaude ? 'Claude spun: ' : ''
  await update($, view, v => ({
    ...v,
    slots: { ...v.slots, grid: r.grid, win: r.win, cells: r.cells, isSpinning: false, message: r.win > 0 ? `${who}WIN ${r.win}` : `${who}No win.` },
  }))
  await score($, r.win)
  if (r.win >= BIG_WIN) $.ui.toast(`🎰 Big win! ${r.win} points`)
}

// Claude's deals draw themselves after a moment, unless the player has taken the hand over.
let autoDraw: { cancel: () => void } | null = null

async function deal($: EngineInterface, byClaude = false): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    if ((await read($, view)).poker.phase === 'dealt') return
    const isBonusPlay = await takeBonus($)
    const d: Deal = isBonusPlay ? bonusDeal() : dealFrom(newSeed())
    const lead = isBonusPlay ? '🏆 Bonus deal! ' : byClaude ? 'Claude dealt. ' : ''
    const after = byClaude ? ` Drawing in ${AUTO_DRAW_MS / 1000} s unless you change a hold.` : ' Pick cards to hold, then DRAW.'
    await update($, view, v => ({
      ...v,
      // A hand that already pays starts held, as on a video poker machine; the player can release any card.
      poker: {
        ...NEW_POKER(),
        cards: d.dealt,
        held: [0, 1, 2, 3, 4].map(i => d.contributing.includes(i)),
        winning: d.contributing,
        phase: 'dealt' as const,
        handId: d.seed,
        isBonus: isBonusPlay,
        message: [lead, d.made ? `You hold: ${d.made}.` : '', after].map(t => t.trim()).filter(Boolean).join(' '),
      },
    }))
    autoDraw?.cancel()
    autoDraw = byClaude ? $.clock.after(AUTO_DRAW_MS, () => void drawIfUntouched($, d.seed)) : null
  } finally {
    inFlight = false
  }
}

async function drawIfUntouched($: EngineInterface, handId: string): Promise<void> {
  const p = (await read($, view)).poker
  if (p.phase === 'dealt' && p.handId === handId && !p.touched) await drawCards($)
}

async function drawCards($: EngineInterface): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    const p = (await read($, view)).poker
    if (p.phase !== 'dealt') return
    autoDraw?.cancel()
    autoDraw = null
    const r = drawFrom(p.handId, p.held.flatMap((h, i) => (h ? [i] : [])))
    const lead = p.isBonus ? '🏆 ' : ''
    await update($, view, v => ({
      ...v,
      poker: {
        ...v.poker,
        cards: r.final,
        winning: r.contributing,
        phase: 'drawn' as const,
        result: r.result,
        win: r.win,
        message: r.win > 0 ? `${lead}${r.result}! WIN ${r.win}` : `${lead}${r.result}. No win.`,
      },
    }))
    await score($, r.win)
    if (r.win >= BIG_WIN) $.ui.toast(`🃏 ${r.result}! ${r.win} points`)
  } finally {
    inFlight = false
  }
}

async function toggleHold($: EngineInterface, i: number): Promise<void> {
  await update($, view, v =>
    v.poker.phase === 'dealt' ? { ...v, poker: { ...v.poker, touched: true, held: v.poker.held.map((h, j) => (j === i ? !h : h)) } } : v,
  )
}

// A Claude turn plays on whichever game is showing. Nothing plays on the Pomodoro tab, with the pane
// hidden, mid-hand, or while a play is running.
async function autoPlay($: EngineInterface): Promise<void> {
  const v = await read($, view)
  if (!v.isPaneOpen || inFlight) return
  if (v.tab === 'slots') await spin($, true)
  else if (v.tab === 'poker' && v.poker.phase !== 'dealt') await deal($, true)
}

// Sponsoring is a thank-you to the creator: it unlocks nothing and buys nothing.
const SPONSORS_URL = 'https://github.com/sponsors/altoption'

async function sponsor($: EngineInterface): Promise<void> {
  await say($, `Opening ${SPONSORS_URL}. Thank you!`)
  if (isGithubPage(SPONSORS_URL)) void $.process.run(['open', SPONSORS_URL]).catch(() => undefined)
}

const PANE_TITLE = '🎰 Terminal Slots'

async function showPane($: EngineInterface): Promise<{ isPlaced: boolean; reason?: string }> {
  const opened = await $.ui.open({ id: PANE, title: PANE_TITLE })
  await update($, view, v => ({ ...v, isPaneOpen: true }))
  return opened as { isPlaced: boolean; reason?: string }
}

async function togglePane($: EngineInterface): Promise<void> {
  if ((await read($, view)).isPaneOpen) {
    // Hidden either way: a close that fails still leaves the toggle offering Show.
    await $.ui.close({ id: PANE }).catch(() => undefined)
    await update($, view, v => ({ ...v, isPaneOpen: false }))
  } else {
    await showPane($)
  }
}

async function setTab($: EngineInterface, tab: CasinoView['tab']): Promise<void> {
  await update($, view, v => ({ ...v, tab, message: '' }))
}

// ---- Pomodoro (local) ------------------------------------------------------------------------------

// Each change bumps the run, so a timer from an earlier start, pause or reload does nothing when it fires.
let pomoRun = 0
let pomoTicker: { cancel: () => void } | null = null

// Applies a change, saves it, and (re)arms the end-of-phase timer and the once-a-second countdown.
async function setPomo($: EngineInterface, change: (p: Pomo, now: number) => Pomo): Promise<Pomo> {
  const now = await $.clock.now()
  let next = newPomo()
  await update($, view, v => {
    next = change(v.pomo, now)
    return { ...v, now, pomo: next }
  })
  await $.store.set('pomo', next)
  const run = ++pomoRun
  pomoTicker?.cancel()
  pomoTicker = null
  if (next.endsAt !== null) {
    $.clock.after(Math.max(0, next.endsAt - now), () => void finishPomo($, run))
    pomoTicker = $.clock.every(1000, () => void tickPomo($, run))
  }
  return next
}

async function tickPomo($: EngineInterface, run: number): Promise<void> {
  if (run !== pomoRun) return
  const now = await $.clock.now()
  await update($, view, v => ({ ...v, now }))
}

// The phase ran out: move on to the next one (stopped) and say so, wherever the player is.
async function finishPomo($: EngineInterface, run: number, wasAway = false): Promise<void> {
  if (run !== pomoRun) return
  const before = (await read($, view)).pomo
  const p = await setPomo($, (p, now) => nextPomo(p, now, true))
  const away = wasAway ? ' (while you were away)' : ''
  $.ui.toast(
    before.phase === 'focus'
      ? `🍅 Pomodoro done${away}! Take a ${POMO_MS[p.phase] / 60_000}-minute break.`
      : `${PHASE_LABEL[before.phase]} is over${away}. Ready to focus?`,
  )
}

// After a restart: the saved timer carries on, or finishes now if it ran out while Claude Code was closed.
async function restorePomo($: EngineInterface): Promise<void> {
  const saved = await $.store.get('pomo')
  const p = isPomo(saved) ? saved : newPomo()
  await setPomo($, () => p)
  if (p.endsAt !== null && p.endsAt <= (await $.clock.now())) await finishPomo($, pomoRun, true)
}

// ---- calibration (local) ---------------------------------------------------------------------------

async function calibrate($: EngineInterface, fn: (c: Calibration) => void): Promise<Calibration> {
  const c = ((await $.store.get('calib')) as Calibration | undefined) ?? newCalibration()
  fn(c)
  c.bets = c.bets.slice(-200)
  await $.store.set('calib', c)
  await update($, view, v => ({ ...v, calib: { settled: c.bets.length, brier: brier(c.bets), pending: c.pending } }))
  return c
}

// ---- hooks -----------------------------------------------------------------------------------------

// Tools the main loop has used since its last turn ended (subagents and the engine's forks don't count).
let turnTools = 0
// The last test run's outcome: tests passing again after a failure is a milestone.
let lastTest: 'pass' | 'fail' | null = null

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'wager',
      description:
        'Before you run a test suite with Bash, call this once with your honest probability (0-1) that it passes. Terminal Slots scores your calibration (Brier score) when the run finishes; nothing is at stake.',
      inputSchema: {
        type: 'object',
        properties: { pPass: { type: 'number', minimum: 0, maximum: 1 } },
        required: ['pPass'],
      },
      isDeferred: false,
    })
    await $.command.register({ name: 'slots', description: 'Show or hide Terminal Slots' })
    await calibrate($, () => undefined)
    // A reload re-runs this but drops timers: nothing can still be spinning, in flight or about to draw.
    inFlight = false
    autoDraw = null
    turnTools = 0
    // Earlier versions kept a game-server session here; nothing uses it now.
    await $.store.delete('session')
    const stats = await $.store.get('stats')
    const bonus = await $.store.get('bonus')
    await update($, view, v => ({
      ...v,
      stats: isStats(stats) ? stats : NEW_STATS(),
      bonus: isBonus(bonus) ? bonus : null,
      slots: { ...v.slots, isSpinning: false },
    }))
    // The timer must never stop the session from starting.
    await restorePomo($).catch(() => undefined)
    void showPane($)
    return next(e)
  })

  on('command.run', { command: 'slots' }, async ($, e) => {
    await togglePane($)
    const v = await read($, view)
    return { text: v.isPaneOpen ? 'Terminal Slots is showing.' : 'Terminal Slots is hidden. /slots or Show brings it back.' }
  })

  // The person closed the pane with its own close mark or key: keep the band's Show/Hide in step.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, view, v => ({ ...v, isPaneOpen: false }))
    return next(e)
  })

  // A main-loop turn that did real work plays once. Only observes: the turn's result passes on unchanged.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      const tools = turnTools
      turnTools = 0
      if (e.reason === 'answer' && tools >= TOOLS_PER_PLAY) void autoPlay($).catch(() => undefined)
    }
    return r
  }).catch(($, e, next) => next(e))

  // Always visible above the prompt: a bonus waiting, the Pomodoro time, and Show/Hide for the pane.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const v = await read($, view)
    return (
      <Box>
        <Text>🎰 Terminal Slots</Text>
        {v.bonus ? <Text color="warning"> · 🏆 bonus ready</Text> : null}
        {isRunning(v.pomo) ? <Text dimColor>{` · ${PHASE_LABEL[v.pomo.phase].split(' ')[0]} ${clockText(pomoLeft(v.pomo, v.now))}`}</Text> : null}
        <Text> </Text>
        <Button key="slots-toggle" label={v.isPaneOpen ? 'Hide' : 'Show'} onPress={() => void togglePane($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // The animated reels need a surface that runs Client modules (terminal, desktop); others get text.
    const Client = 'Client' in elements ? elements.Client : null
    const v = await read($, view)
    const columns = e.props.bodyColumns
    const lines = (rows: string[]) => rows.map(row => <Text>{row}</Text>)

    const header = (
      <Box flexDirection="column">
        <Box>
          <Button key="tab-slots" variant={v.tab === 'slots' ? 'primary' : undefined} label="Slots" onPress={() => void setTab($, 'slots')} />
          <Text> </Text>
          <Button key="tab-poker" variant={v.tab === 'poker' ? 'primary' : undefined} label="Poker" onPress={() => void setTab($, 'poker')} />
          <Text> </Text>
          <Button key="tab-pomodoro" variant={v.tab === 'pomodoro' ? 'primary' : undefined} label="Pomodoro" onPress={() => void setTab($, 'pomodoro')} />
          <Text> </Text>
          <Button key="sponsor" label="💖 Sponsor" onPress={() => void sponsor($)} />
        </Box>
        {v.tab !== 'pomodoro' ? (
          <Text dimColor>
            {v.stats.plays.toLocaleString()} plays · {v.stats.points.toLocaleString()} points · best {v.stats.best.toLocaleString()}
            {v.bonus ? <Text color="warning"> · 🏆 next play is a bonus</Text> : null}
          </Text>
        ) : null}
      </Box>
    )

    if (v.tab === 'pomodoro') {
      const p = v.pomo
      const left = pomoLeft(p, v.now)
      const isFull = !isRunning(p) && p.leftMs === POMO_MS[p.phase]
      const barWidth = Math.max(10, Math.min(40, columns - 2))
      return (
        <Box flexDirection="column">
          {header}
          <Text> </Text>
          <Text bold color={p.phase === 'focus' ? RED : 'success'}>
            {PHASE_LABEL[p.phase]}
          </Text>
          <Text bold>{clockText(left)}</Text>
          <Text color={p.phase === 'focus' ? RED : 'success'}>{progressBar(p, v.now, barWidth)}</Text>
          <Text> </Text>
          <Box>
            {isRunning(p) ? (
              <Button key="pomo-pause" label="Pause" onPress={() => void setPomo($, pausePomo)} />
            ) : (
              <Button key="pomo-start" variant="primary" label={isFull ? 'Start' : 'Resume'} onPress={() => void setPomo($, startPomo)} />
            )}
            <Text> </Text>
            <Button key="pomo-reset" label="Reset" onPress={() => void setPomo($, resetPomo)} />
            <Text> </Text>
            <Button key="pomo-skip" label="Skip" onPress={() => void setPomo($, (p, now) => nextPomo(p, now, false))} />
          </Box>
          <Text> </Text>
          <Text>
            {'🍅'.repeat(Math.min(p.round, ROUND))}
            <Text dimColor>{'○'.repeat(Math.max(0, ROUND - p.round))}</Text>
            <Text dimColor>{` · ${p.day === dayOf(v.now) ? p.today : 0} today`}</Text>
          </Text>
          <Text dimColor>25 min focus · 5 min break · 15 min after every 4th</Text>
          <Text dimColor>Runs while you work, even with the pane hidden.</Text>
          {v.message ? <Text dimColor>{v.message}</Text> : null}
        </Box>
      )
    }

    // Shown once Claude has predicted a test run: how often its confidence matched what happened.
    const calib =
      v.calib.settled > 0 || v.calib.pending !== null ? (
        <Text dimColor>
          Claude's test predictions: {v.calib.settled}
          {v.calib.brier === null ? '' : ` · Brier ${v.calib.brier.toFixed(3)} (0 is perfect)`}
          {v.calib.pending === null ? '' : ` · now predicting ${Math.round(v.calib.pending * 100)}% pass`}
        </Text>
      ) : null

    const hint = <Text dimColor>Claude's busy turns play here too; commits, PRs and fixed tests earn a 🏆 bonus.</Text>

    if (v.tab === 'slots') {
      return (
        <Box flexDirection="column">
          {header}
          <Text> </Text>
          {Client ? (
            <Client
              key="reels"
              module="./reels.tsx"
              props={{ grid: v.slots.grid, cells: v.slots.cells, isSpinning: v.slots.isSpinning, columns }}
            />
          ) : (
            lines(renderReels(v.slots.grid, columns, v.slots.isSpinning ? [] : v.slots.cells))
          )}
          <Text bold color={v.slots.isBonus && !v.slots.isSpinning ? 'warning' : undefined}>
            {v.slots.isSpinning ? (v.slots.isBonus ? '🏆 bonus spin…' : 'spinning…') : v.slots.message || v.message || ' '}
          </Text>
          <Box>
            <Button key="spin" variant="primary" label="SPIN" onPress={() => void spin($)} />
          </Box>
          <Text dimColor>Barn of Fortune · 10 lines</Text>
          {hint}
          {calib}
        </Box>
      )
    }

    const isDealt = v.poker.phase === 'dealt'
    return (
      <Box flexDirection="column">
        {header}
        <Text> </Text>
        {columns < 30 ? (
          <Box flexDirection="column">
            {/* Inline text below 30 columns: brackets mark held cards, then the paying cards after a draw. */}
            <Box>
              {v.poker.cards.map((card, i) => {
                const isMarked = isDealt ? v.poker.held[i] === true : v.poker.winning.includes(i)
                const face = card ? cardText(card) : '##'
                return (
                  <Text key={`inline-${i}`} color={isRedCard(card) ? RED : undefined} bold={isMarked}>
                    {isMarked ? `[${face}]` : ` ${face} `}
                  </Text>
                )
              })}
            </Box>
            {isDealt ? (
              <Box>
                {[0, 1, 2, 3, 4].map(i => (
                  <Button key={`hold-${i}`} label={v.poker.held[i] ? `[${i + 1}]` : `${i + 1}`} onPress={() => void toggleHold($, i)} />
                ))}
              </Box>
            ) : null}
          </Box>
        ) : (
          // One column per card: the card's border shows HELD (double, yellow) or part of the
          // paying hand (green; bold once drawn), and its HOLD button sits directly under it.
          <Box>
            {[0, 1, 2, 3, 4].map(i => {
              const isHeld = isDealt && v.poker.held[i] === true
              const isWinning = v.poker.winning.includes(i)
              const size = columns >= 46 ? 'full' : 'mini'
              return (
                <Box key={`card-${i}`} flexDirection="column" alignItems="center" marginRight={1}>
                  <Box
                    flexDirection="column"
                    borderStyle={isHeld ? 'double' : isWinning ? 'bold' : 'single'}
                    borderColor={isWinning ? 'success' : isHeld ? 'suggestion' : v.poker.isBonus ? 'warning' : undefined}
                  >
                    {isDealt ? (
                      // The face itself is a borderless button: a click anywhere on it holds or releases the card.
                      <Button key={`card-${i}`} plain label={`card ${i + 1}`} onPress={() => void toggleHold($, i)}>
                        <Text color={isRedCard(v.poker.cards[i] ?? null) ? RED : undefined}>
                          {cardFace(v.poker.cards[i] ?? null, size).join('\n')}
                        </Text>
                      </Button>
                    ) : (
                      cardFace(v.poker.cards[i] ?? null, size).map((line, n) => (
                        <Text key={`face-${i}-${n}`} color={isRedCard(v.poker.cards[i] ?? null) ? RED : undefined}>
                          {line}
                        </Text>
                      ))
                    )}
                  </Box>
                  {isDealt ? (
                    <Button
                      key={`hold-${i}`}
                      hotkey={`${i + 1}`}
                      label={size === 'full' ? (isHeld ? 'HELD' : 'HOLD') : isHeld ? '✓' : `${i + 1}`}
                      onPress={() => void toggleHold($, i)}
                    />
                  ) : (
                    <Text> </Text>
                  )}
                </Box>
              )
            })}
          </Box>
        )}
        <Text bold color={v.poker.isBonus ? 'warning' : undefined}>
          {v.poker.message || v.message || ' '}
        </Text>
        <Box>
          {isDealt ? (
            <Button key="draw" variant="primary" label="DRAW" onPress={() => void drawCards($)} />
          ) : (
            <Button key="deal" variant="primary" label="DEAL" onPress={() => void deal($)} />
          )}
        </Box>
        <Text dimColor>Click a card or press 1-5 to hold</Text>
        {hint}
        {calib}
      </Box>
    )
  })

  on('tool.call', async ($, e, next) => {
    // Compared as a string: the tool union includes MCP tools without a `tool` key in their type.
    const call = e as unknown as { tool: string; command?: string; pPass?: number; agentId?: string }
    if (call.tool === WAGER) {
      const pPass = Math.max(0, Math.min(1, Number(call.pPass)))
      await calibrate($, c => {
        c.pending = pPass
      })
      return { result: `Recorded P(pass)=${pPass}. Now run the tests.` }
    }
    if (call.agentId === undefined) turnTools += 1

    const ran = await next(e)

    // Bookkeeping after the tool ran must never fail the call: its errors stop here.
    try {
      const isBash = call.tool === 'Bash' && ran.deny === undefined
      const outcome = isBash ? testOutcome(call.command ?? '', ran.isError === true) : null
      if (outcome) {
        const c = await calibrate($, c => {
          if (c.pending !== null) c.bets.push({ pPass: c.pending, passed: outcome === 'pass' })
          c.pending = null
        })
        if (outcome === 'pass' && lastTest === 'fail') await earnBonus($, 'tests')
        else if (outcome === 'pass') $.ui.toast(`✅ Tests passed · Claude's Brier ${brier(c.bets)?.toFixed(3) ?? 'n/a'}`)
        lastTest = outcome
      }
      const milestone = isBash && ran.isError !== true ? milestoneOf(call.command ?? '') : null
      if (milestone) await earnBonus($, milestone)
    } catch {
      // the games are cosmetic
    }
    return ran
    // Fail open: a hook that threw before next() lets the tool run; after next(), the engine
    // replays the settled result instead of running the tool again.
  }).catch(($, e, next) => next(e))
}
