import { expect, test } from 'claude-code/testing'

import { barnOfFortune, dealFromSeed, holdsToMask, resolvePokerRound, royalDraw, runSpin, scoreDealt } from '../hooks/engine/slots-engine.js'

test('the vendored engine runs inside the mod: a seeded spin and a seeded poker round', async () => {
  const a = runSpin(barnOfFortune, { betLevel: 10, activeLines: barnOfFortune.lines.lines.length, seed: 'abc' })
  const b = runSpin(barnOfFortune, { betLevel: 10, activeLines: barnOfFortune.lines.lines.length, seed: 'abc' })
  expect(a.grid).toHaveLength(5)
  expect(a).toEqual(b)
  const dealt = dealFromSeed('xyz').dealt
  expect(dealt).toHaveLength(5)
  expect(typeof scoreDealt(royalDraw, dealt, 10).result.label).toBe('string')
  const r = resolvePokerRound(royalDraw, { seed: 'xyz', holdMask: holdsToMask([0, 1]), bet: 10 }) as { final?: string[] }
  expect(r).toBeTruthy()
})
