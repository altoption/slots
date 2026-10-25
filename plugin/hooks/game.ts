// Claude's calibration ledger: local stats only, no tokens at stake.

export type Outcome = 'pass' | 'fail'
export type Calibration = { bets: { pPass: number; passed: boolean }[]; pending: number | null }

export const newCalibration = (): Calibration => ({ bets: [], pending: null })

export const brier = (bets: Calibration['bets']): number | null =>
  bets.length === 0 ? null : bets.reduce((s, b) => s + (b.pPass - (b.passed ? 1 : 0)) ** 2, 0) / bets.length

const TEST = /\b(vitest|jest|pytest|mocha|playwright test|dotnet test|go test|cargo test|(npm|pnpm|yarn|bun)( run)? test)\b/

// A Bash command that ran a test suite, and whether it passed.
export const testOutcome = (command: string, isError: boolean): Outcome | null =>
  TEST.test(command) ? (isError ? 'fail' : 'pass') : null

// Only https, or plain http to this machine, may carry the session token.
export const isSafeHost = (url: string): boolean => /^https:\/\/[^\s/]+/.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url)

// Only GitHub's own https pages may be handed to the OS launcher.
export const isGithubPage = (uri: unknown): uri is string => {
  if (typeof uri !== 'string' || uri.startsWith('-')) return false
  try {
    const url = new URL(uri)
    return url.protocol === 'https:' && url.hostname === 'github.com' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

// The host's own membership page, opened only for a host that may carry the session.
export const memberPageUrl = (hostUrl: string): string | null => {
  if (!isSafeHost(hostUrl)) return null
  try {
    return `${new URL(hostUrl).origin}/#membership`
  } catch {
    return null
  }
}
