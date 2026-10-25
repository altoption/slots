import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CasinoView } from '../types'
import { cardFace, cardText, isRedCard, randomGrid, renderReels } from './ascii'
import { brier, isGithubPage, isSafeHost, memberPageUrl, newCalibration, testOutcome, type Calibration } from './game'

const PANE = 'slots'
const WAGER = 'mcp__terminal-slots__wager'
const SLOT_BETS = [10, 20, 50, 100]
const POKER_BETS = [5, 10, 25, 50, 100]
const BIG_WIN = 20 // × bet
const RED = 'error' // the theme's red: hearts and diamonds
// A supporter's name, one colour per letter, the way Claude Code draws "ultrathink".
const RAINBOW = ['#E5534B', '#E8853D', '#E5C07B', '#7EC77E', '#5DA9E9', '#9D8FE0', '#D97FC9']


// Bump the tag when CasinoView's fields change: a reload declines the old value.
const NEW_SLOTS = (): CasinoView['slots'] => ({ grid: randomGrid(Math.random), bet: 10, win: 0, cells: [], isSpinning: false, message: '' })
const NEW_POKER = (): CasinoView['poker'] => ({
  cards: [null, null, null, null, null],
  held: [false, false, false, false, false],
  winning: [],
  phase: 'idle',
  bet: 10,
  result: '',
  win: 0,
  message: '',
})
const view = atom(
  { plugin: 'terminal-slots', key: 'view' } as const,
  {
    tab: 'slots',
    account: null,
    device: null,
    message: '',
    isBusy: false,
    isPaneOpen: false,
    showNudge: false,
    slots: NEW_SLOTS(),
    poker: NEW_POKER(),
    calib: { settled: 0, brier: null, pending: null },
  } as CasinoView,
  { shape: 'view-8' },
)

// Fixed: the mod only ever talks to the Terminal Slots host. Edit here to develop against localhost.
const hostUrl = 'https://terminal-slots.altoption.workers.dev'

type ApiResult = { status: number; body: Record<string, any> }

// Every host call: the session token rides in a header, never in the URL or a log.
async function api($: EngineInterface, method: string, path: string, body?: unknown): Promise<ApiResult> {
  if (!isSafeHost(hostUrl)) return { status: 0, body: { error: `refusing insecure host ${hostUrl}` } }
  const token = (await $.store.get('session')) as string | undefined
  try {
    const res = await $.http.fetch(hostUrl.replace(/\/$/, '') + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const parsed = JSON.parse(res.text || '{}') as Record<string, any>
    if (res.status === 401 && token) {
      await $.store.delete('session')
      await update($, view, v => ({ ...v, account: null, slots: NEW_SLOTS(), poker: NEW_POKER() }))
    }
    return { status: res.status, body: parsed }
  } catch {
    return { status: 0, body: { error: `host unreachable: ${hostUrl}` } }
  }
}

// Responses can land out of order (a spin waits ~0.9 s before it shows). Each request takes a ticket
// when it starts; a wallet older than the one already shown is ignored.
let ticket = 0
let shownTicket = 0
const takeTicket = () => ++ticket

const sameCards = (a: readonly (string | null)[], b: readonly string[]) => a.length === b.length && a.every((c, i) => c === b[i])

const heldFrom = (contributing: unknown): boolean[] => [0, 1, 2, 3, 4].map(i => Array.isArray(contributing) && contributing.includes(i))

/**
 * Applies a wallet from the host. When it carries `openHand` (every `/v1/me`-shaped answer does), the
 * pane follows the server: a hand open there is shown (and its paying cards held); a hand the pane
 * still shows as open but the server has finished is closed.
 */
async function setAccount($: EngineInterface, body: Record<string, any>, at: number): Promise<void> {
  if (typeof body.login !== 'string' || at < shownTicket) return
  shownTicket = at
  await update($, view, v => {
    let poker = v.poker
    if ('openHand' in body) {
      const open = body.openHand as { dealt: string[]; bet: number; made: string | null; contributing: number[] } | null
      if (open && (v.poker.phase !== 'dealt' || !sameCards(v.poker.cards, open.dealt))) {
        poker = {
          ...NEW_POKER(),
          cards: open.dealt,
          held: heldFrom(open.contributing),
          winning: open.contributing ?? [],
          phase: 'dealt',
          bet: open.bet,
          message: open.made ? `Hand resumed. You hold: ${open.made}` : 'Hand resumed. Pick cards to hold, then DRAW.',
        }
      } else if (!open && v.poker.phase === 'dealt') {
        poker = { ...NEW_POKER(), bet: v.poker.bet, message: 'That hand was finished elsewhere. DEAL again.' }
      }
    }
    return {
      ...v,
      account: {
        login: body.login,
        balance: body.balance,
        nextLootboxMs: body.nextLootboxMs,
        isMember: body.membership?.isMember === true,
        canRefill: body.canRefill === true,
      },
      poker,
    }
  })
}

// Re-reads the wallet and any open hand from the server: used after a refused or lost game request.
async function resync($: EngineInterface): Promise<void> {
  const at = takeTicket()
  const me = await api($, 'GET', '/v1/me')
  if (me.status === 200) await setAccount($, me.body, at)
}

async function say($: EngineInterface, message: string): Promise<void> {
  await update($, view, v => ({ ...v, message }))
}

const brokeHint = (error: string) =>
  /not enough tokens/.test(error) ? `${error}. Lower the bet, or use 💰 I'm Rich or 🆓 refill.` : error

const entryId = () => crypto.randomUUID().replace(/-/g, '')

// ---- sign-in: GitHub device flow, proxied by the host --------------------------------------------

let signInRun = 0

async function signIn($: EngineInterface): Promise<void> {
  const run = ++signInRun
  const start = await api($, 'POST', '/v1/device/start')
  if (start.status !== 200) return say($, start.body.error ?? 'sign-in failed to start')
  const { deviceCode, userCode, verificationUri, interval, expiresIn } = start.body
  await update($, view, v => ({ ...v, device: { userCode, uri: verificationUri }, message: '' }))
  // The URI comes from the host: launch it only when it is GitHub's own https page.
  if (isGithubPage(verificationUri)) void $.process.run(['open', verificationUri]).catch(() => undefined)
  const deadline = (await $.clock.now()) + expiresIn * 1000
  schedulePoll($, run, deviceCode, interval, deadline)
}

function schedulePoll($: EngineInterface, run: number, deviceCode: string, interval: number, deadline: number): void {
  $.clock.after(interval * 1000, () => void pollOnce($, run, deviceCode, interval, deadline))
}

async function pollOnce($: EngineInterface, run: number, deviceCode: string, interval: number, deadline: number): Promise<void> {
  if (run !== signInRun) return // cancelled or superseded
  if ((await $.clock.now()) > deadline) {
    await update($, view, v => ({ ...v, device: null, message: 'Code expired. Sign in again.' }))
    return
  }
  const r = await api($, 'POST', '/v1/device/poll', { deviceCode })
  const status = r.body.status
  if (status === 'pending') return schedulePoll($, run, deviceCode, interval, deadline)
  if (status === 'slow_down') return schedulePoll($, run, deviceCode, r.body.interval ?? interval + 5, deadline)
  if (status === 'ok' && typeof r.body.token === 'string') {
    await $.store.set('session', r.body.token)
    await update($, view, v => ({ ...v, device: null, message: `Welcome, ${r.body.login}!` }))
    await setAccount($, r.body, takeTicket())
    return
  }
  await update($, view, v => ({ ...v, device: null, message: `Sign-in stopped: ${status ?? r.body.error ?? 'unknown'}` }))
}

async function signOut($: EngineInterface): Promise<void> {
  signInRun += 1
  await api($, 'POST', '/v1/logout')
  await $.store.delete('session')
  await update($, view, v => ({ ...v, account: null, device: null, message: 'Signed out.', slots: NEW_SLOTS(), poker: NEW_POKER() }))
}

// ---- games -----------------------------------------------------------------------------------------

// Set synchronously, before any await, so a double press can't start two requests.
let inFlight = false

async function spin($: EngineInterface): Promise<void> {
  if (inFlight) return
  inFlight = true
  const at = takeTicket()
  const v = await read($, view)
  if (v.account && v.account.balance < v.slots.bet) {
    inFlight = false
    return // the pane shows SPIN as unpressable text and says why
  }
  await update($, view, v => ({ ...v, isBusy: true, showNudge: false, slots: { ...v.slots, isSpinning: true, cells: [], win: 0, message: '' } }))
  const startedAt = await $.clock.now()
  const r = await api($, 'POST', '/v1/slots/spin', { bet: v.slots.bet, entryId: entryId() })
  // Let the reels run at least ~0.9 s so the result lands like a spin, not a flicker.
  const wait = Math.max(0, 900 - ((await $.clock.now()) - startedAt))
  $.clock.after(wait, () => void landSpin($, r, at))
}

// The reels Client animates on its own clock; this only hands it the result.
async function landSpin($: EngineInterface, r: ApiResult, at: number): Promise<void> {
  inFlight = false
  if (r.status !== 200) {
    await update($, view, v => ({
      ...v,
      isBusy: false,
      slots: { ...v.slots, isSpinning: false, message: brokeHint(r.body.error ?? 'spin failed') },
    }))
    return
  }
  const cells = (r.body.wins as { cells: { reel: number; row: number }[] }[]).flatMap(w => w.cells)
  await update($, view, v => ({
    ...v,
    isBusy: false,
    slots: { ...v.slots, grid: r.body.grid, win: r.body.win, cells, isSpinning: false, message: r.body.win > 0 ? `WIN +${r.body.win}` : '' },
  }))
  await setAccount($, r.body, at)
  if (r.body.win >= r.body.bet * BIG_WIN) $.ui.toast(`🎰 Big win! +${r.body.win} tokens`)
}

async function deal($: EngineInterface): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    const at = takeTicket()
    const v = await read($, view)
    if (v.poker.phase === 'dealt') return
    if (v.account && v.account.balance < v.poker.bet) return // the pane shows DEAL as unpressable text
    await update($, view, v => ({ ...v, isBusy: true, showNudge: false, poker: { ...v.poker, message: '' } }))
    const r = await api($, 'POST', '/v1/poker/deal', { bet: v.poker.bet, entryId: entryId() })
    if (r.status !== 200) {
      await update($, view, v => ({ ...v, poker: { ...v.poker, message: brokeHint(r.body.error ?? 'deal failed') } }))
      // A hand already open there (dealt elsewhere, or this deal landed but its answer was lost): show it.
      if (r.status === 409 || r.status === 0) await resync($)
      return
    }
    await update($, view, v => ({
      ...v,
      // A hand that already pays starts held, as on a video poker machine; the player can release any card.
      poker: {
        ...v.poker,
        cards: r.body.dealt,
        held: heldFrom(r.body.contributing),
        winning: r.body.contributing ?? [],
        phase: 'dealt' as const,
        result: '',
        win: 0,
        message: r.body.made ? `You hold: ${r.body.made}` : 'Pick cards to hold, then DRAW.',
      },
    }))
    await setAccount($, r.body, at)
  } finally {
    inFlight = false
    await update($, view, v => ({ ...v, isBusy: false }))
  }
}

async function drawCards($: EngineInterface): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    const at = takeTicket()
    const v = await read($, view)
    if (v.poker.phase !== 'dealt') return
    await update($, view, v => ({ ...v, isBusy: true }))
    const holds = v.poker.held.flatMap((h, i) => (h ? [i] : []))
    const r = await api($, 'POST', '/v1/poker/draw', { holds })
    if (r.status !== 200) {
      await update($, view, v => ({ ...v, poker: { ...v.poker, message: r.body.error ?? 'draw failed' } }))
      // The hand was finished elsewhere, or this draw landed but its answer was lost: follow the server.
      if (r.status === 409 || r.status === 0) await resync($)
      return
    }
    await update($, view, v => ({
      ...v,
      poker: {
        ...v.poker,
        cards: r.body.final,
        winning: r.body.contributing ?? [],
        phase: 'drawn' as const,
        result: r.body.result,
        win: r.body.win,
        message: r.body.win > 0 ? `${r.body.result}! +${r.body.win}` : `${r.body.result}. No win.`,
      },
    }))
    await setAccount($, r.body, at)
  } finally {
    inFlight = false
    await update($, view, v => ({ ...v, isBusy: false }))
  }
}

async function toggleHold($: EngineInterface, i: number): Promise<void> {
  await update($, view, v =>
    v.poker.phase === 'dealt' ? { ...v, poker: { ...v.poker, held: v.poker.held.map((h, j) => (j === i ? !h : h)) } } : v,
  )
}

async function cycleBet($: EngineInterface, game: 'slots' | 'poker'): Promise<void> {
  const next = (list: number[], bet: number) => list[(list.indexOf(bet) + 1) % list.length] ?? list[0]!
  await update($, view, v =>
    game === 'slots'
      ? { ...v, slots: { ...v.slots, bet: next(SLOT_BETS, v.slots.bet) } }
      : v.poker.phase === 'dealt'
        ? v
        : { ...v, poker: { ...v.poker, bet: next(POKER_BETS, v.poker.bet) } },
  )
}

async function openLootbox($: EngineInterface): Promise<void> {
  const at = takeTicket()
  const r = await api($, 'POST', '/v1/lootbox')
  if (r.status === 200) {
    await say($, `💰 I'm Rich :) ${String(r.body.prize.label).toUpperCase()}: +${r.body.prize.tokens} tokens`)
    await update($, view, v => ({ ...v, showNudge: r.body.membership?.isMember !== true }))
    if (r.body.prize.tokens >= 2000) $.ui.toast(`💰 I'm Rich :) ${r.body.prize.label}! +${r.body.prize.tokens}`)
    await setAccount($, r.body, at)
  } else if (r.status === 429 && typeof r.body.nextLootboxMs === 'number') {
    const minutes = Math.ceil((r.body.nextLootboxMs - (await $.clock.now())) / 60000)
    await say($, `Not that rich yet: try again in ${minutes} min.`)
  } else {
    await say($, r.body.error ?? "I'm Rich failed")
  }
}

async function refill($: EngineInterface): Promise<void> {
  const at = takeTicket()
  const r = await api($, 'POST', '/v1/refill')
  if (r.status === 200) {
    await say($, `🆓 Refilled: +${r.body.refilled} tokens. Enjoying it? ★ Support the creator.`)
    await setAccount($, r.body, at)
  } else {
    await say($, r.body.error ?? 'refill failed')
  }
}

async function openMembership($: EngineInterface): Promise<void> {
  const url = memberPageUrl(hostUrl)
  if (!url) return say($, `Membership page unavailable for host ${hostUrl}`)
  await say($, `Opening ${url}`)
  void $.process.run(['open', url]).catch(() => undefined)
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
  await update($, view, v => ({ ...v, tab, message: '', showNudge: false }))
}

// ---- calibration (local, no tokens) ----------------------------------------------------------------

async function calibrate($: EngineInterface, fn: (c: Calibration) => void): Promise<Calibration> {
  const c = ((await $.store.get('calib')) as Calibration | undefined) ?? newCalibration()
  fn(c)
  c.bets = c.bets.slice(-200)
  await $.store.set('calib', c)
  await update($, view, v => ({ ...v, calib: { settled: c.bets.length, brier: brier(c.bets), pending: c.pending } }))
  return c
}

// ---- hooks -----------------------------------------------------------------------------------------

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
    await $.command.register({ name: 'slots', description: 'Show or hide Terminal Slots; "/slots logout" to sign out' })
    await calibrate($, () => undefined)
    // A reload re-runs this but drops timers: nothing can still be spinning or in flight.
    inFlight = false
    await update($, view, v => ({ ...v, isBusy: false, slots: { ...v.slots, isSpinning: false } }))
    if (await $.store.get('session')) {
      const at = takeTicket()
      const me = await api($, 'GET', '/v1/me')
      if (me.status === 200) await setAccount($, me.body, at)
      else if (me.status !== 401) await say($, `Can't reach the game host right now (${me.body.error ?? me.status}). Your session is kept.`)
    }
    void showPane($)
    return next(e)
  })

  on('command.run', { command: 'slots' }, async ($, e) => {
    if ((e.args ?? '').trim() === 'logout') {
      await signOut($)
      return { text: 'Signed out of Terminal Slots.' }
    }
    await togglePane($)
    const v = await read($, view)
    return { text: v.isPaneOpen ? 'Terminal Slots is showing.' : 'Terminal Slots is hidden. /slots or Show brings it back.' }
  })

  // The person closed the pane with its own close mark or key: keep the band's Show/Hide in step.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, view, v => ({ ...v, isPaneOpen: false }))
    return next(e)
  })

  // Always visible above the prompt: the balance and a Show/Hide toggle for the pane.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const v = await read($, view)
    return (
      <Box>
        <Text>🎰 Terminal Slots</Text>
        <Text dimColor>{v.account ? ` · ${v.account.balance.toLocaleString()} tokens ` : ' '}</Text>
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
        </Box>
        {v.account ? (
          <Box>
            <Text bold>{v.account.balance.toLocaleString()} tokens</Text>
            <Text dimColor> · </Text>
            {v.account.isMember ? (
              // One Text holding the coloured letters, so the name flows inline instead of stacking.
              <Text bold>
                {[...v.account.login].map((ch, n) => (
                  <Text key={`name-${n}`} color={RAINBOW[n % RAINBOW.length]}>
                    {ch}
                  </Text>
                ))}
                <Text color="warning"> ★</Text>
              </Text>
            ) : (
              <Text dimColor>{v.account.login}</Text>
            )}
            <Text> </Text>
            <Button key="loot" label="💰 I'm Rich :)" onPress={() => void openLootbox($)} />
            {/* Optional items are direct children of the row: a fragment would start a new line. */}
            {v.account.isMember ? null : <Text> </Text>}
            {v.account.isMember ? null : <Button key="support" label="★ Support" onPress={() => void openMembership($)} />}
          </Box>
        ) : null}
      </Box>
    )

    // Broke: the free refill, with the support link beside it. Support never buys tokens.
    const brokeRow =
      v.account && v.account.canRefill ? (
        <Box>
          <Text bold>Out of tokens? </Text>
          <Button key="refill" variant="primary" label="🆓 Free refill (+500)" onPress={() => void refill($)} />
          {v.account.isMember ? null : <Text> </Text>}
          {v.account.isMember ? null : (
            <Button key="support-broke" label="★ Support the creator" onPress={() => void openMembership($)} />
          )}
        </Box>
      ) : null

    const nudgeRow =
      v.account && v.showNudge && !v.account.isMember ? (
        <Box>
          <Text dimColor>Enjoying it? </Text>
          <Button key="support-nudge" label="★ Support the creator" onPress={() => void openMembership($)} />
        </Box>
      ) : null

    if (!v.account) {
      return (
        <Box flexDirection="column">
          {header}
          <Text> </Text>
          <Text>Free tokens, slots and video poker. Sign in with GitHub to play.</Text>
          {v.device ? (
            <Box flexDirection="column">
              <Text>Enter this code at {v.device.uri}:</Text>
              <Text bold>{v.device.userCode}</Text>
              <Text dimColor>Waiting for GitHub…</Text>
            </Box>
          ) : (
            <Button key="signin" variant="primary" label="Sign in with GitHub" onPress={() => void signIn($)} />
          )}
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

    // A bet the balance can't cover: the action becomes plain text and the pane says why.
    const unaffordable = (bet: number) =>
      v.account && v.account.balance < bet ? `Bet ${bet} is more than your ${v.account.balance.toLocaleString()} tokens. Lower the bet.` : null

    if (v.tab === 'slots') {
      return (
        <Box flexDirection="column">
          {header}
          {brokeRow}
          {nudgeRow}
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
          <Text bold>{v.slots.isSpinning ? 'spinning…' : v.slots.message || v.message || ' '}</Text>
          <Box>
            {unaffordable(v.slots.bet) ? (
              <Text dimColor>[ SPIN ]</Text>
            ) : (
              <Button key="spin" variant="primary" label="SPIN" onPress={() => void spin($)} />
            )}
            <Text> </Text>
            <Button key="slot-bet" label={`Bet ${v.slots.bet}`} onPress={() => void cycleBet($, 'slots')} />
          </Box>
          {unaffordable(v.slots.bet) ? <Text color="warning">{unaffordable(v.slots.bet)}</Text> : null}
          <Text dimColor>Barn of Fortune · 10 lines</Text>
          {calib}
        </Box>
      )
    }

    const isDealt = v.poker.phase === 'dealt'
    return (
      <Box flexDirection="column">
        {header}
        {brokeRow}
        {nudgeRow}
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
                    borderColor={isWinning ? 'success' : isHeld ? 'suggestion' : v.account?.isMember ? 'warning' : undefined}
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
        <Text bold>{v.poker.message || v.message || ' '}</Text>
        <Box>
          {isDealt ? (
            <Button key="draw" variant="primary" label="DRAW" onPress={() => void drawCards($)} />
          ) : (
            unaffordable(v.poker.bet) ? (
              <Text dimColor>[ DEAL ]</Text>
            ) : (
              <Button key="deal" variant="primary" label="DEAL" onPress={() => void deal($)} />
            )
          )}
          <Text> </Text>
          <Button key="poker-bet" label={`Bet ${v.poker.bet}`} onPress={() => void cycleBet($, 'poker')} />
        </Box>
        {!isDealt && unaffordable(v.poker.bet) ? <Text color="warning">{unaffordable(v.poker.bet)}</Text> : null}
        <Text dimColor>Click a card or press 1-5 to hold</Text>
        {calib}
      </Box>
    )
  })

  on('tool.call', async ($, e, next) => {
    // Compared as a string: the tool union includes MCP tools without a `tool` key in their type.
    const call = e as unknown as { tool: string; command?: string; pPass?: number }
    if (call.tool === WAGER) {
      const pPass = Math.max(0, Math.min(1, Number(call.pPass)))
      await calibrate($, c => {
        c.pending = pPass
      })
      return { result: `Recorded P(pass)=${pPass}. Now run the tests.` }
    }

    const ran = await next(e)

    // Bookkeeping after the tool ran must never fail the call: its errors stop here.
    try {
      const outcome = call.tool === 'Bash' && ran.deny === undefined ? testOutcome(call.command ?? '', ran.isError === true) : null
      if (outcome) {
        const c = await calibrate($, c => {
          if (c.pending !== null) c.bets.push({ pPass: c.pending, passed: outcome === 'pass' })
          c.pending = null
        })
        if (outcome === 'pass') $.ui.toast(`✅ Tests passed · Claude's Brier ${brier(c.bets)?.toFixed(3) ?? 'n/a'}`)
      }
    } catch {
      // calibration is cosmetic
    }
    return ran
    // Fail open: a hook that threw before next() lets the tool run; after next(), the engine
    // replays the settled result instead of running the tool again.
  }).catch(($, e, next) => next(e))
}
