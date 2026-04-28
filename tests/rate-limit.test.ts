import { describe, it, expect, beforeEach } from 'vitest'
import {
  checkRateLimit,
  _resetRateLimitForTests,
} from '../src/server/rate-limit'

beforeEach(() => {
  _resetRateLimitForTests()
})

describe('checkRateLimit', () => {
  it('allows requests under the limit', () => {
    expect(checkRateLimit('1.2.3.4', 3, 60_000)).toBe(true)
    expect(checkRateLimit('1.2.3.4', 3, 60_000)).toBe(true)
    expect(checkRateLimit('1.2.3.4', 3, 60_000)).toBe(true)
  })

  it('rejects requests over the limit', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('1.2.3.4', 3, 60_000)
    expect(checkRateLimit('1.2.3.4', 3, 60_000)).toBe(false)
    expect(checkRateLimit('1.2.3.4', 3, 60_000)).toBe(false)
  })

  it('isolates buckets per key', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('1.1.1.1', 3, 60_000)
    expect(checkRateLimit('1.1.1.1', 3, 60_000)).toBe(false)
    expect(checkRateLimit('2.2.2.2', 3, 60_000)).toBe(true)
  })

  it('resets after the window expires', async () => {
    expect(checkRateLimit('host', 1, 50)).toBe(true)
    expect(checkRateLimit('host', 1, 50)).toBe(false)
    await new Promise(r => setTimeout(r, 70))
    expect(checkRateLimit('host', 1, 50)).toBe(true)
  })
})
