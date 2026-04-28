import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createFeedbackHandler } from '../src/server/handler'
import { _resetRateLimitForTests } from '../src/server/rate-limit'
import type { FeedbackAdapter } from '../src/adapters/types'

const validBody = {
  type: 'bug' as const,
  title: 'Save button is broken',
  description: 'Clicking save does nothing on the wizard.',
}

function makeAdapter(
  result: { ok: true; ticketUrl?: string } | { ok: false; error?: string }
): FeedbackAdapter {
  return {
    name: 'mock',
    submit: vi.fn().mockResolvedValue(result),
  }
}

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  _resetRateLimitForTests()
})

describe('createFeedbackHandler', () => {
  it('returns 200 with ticketUrl when adapter succeeds', async () => {
    const handler = createFeedbackHandler({
      adapter: makeAdapter({ ok: true, ticketUrl: 'https://linear.app/x' }),
    })
    const res = await handler(makeRequest(validBody))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, ticketUrl: 'https://linear.app/x' })
  })

  it('returns 400 on invalid JSON', async () => {
    const handler = createFeedbackHandler({
      adapter: makeAdapter({ ok: true }),
    })
    const req = new Request('http://localhost/api/feedback', {
      method: 'POST',
      body: 'not json',
    })
    const res = await handler(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 when validation fails (missing title)', async () => {
    const handler = createFeedbackHandler({
      adapter: makeAdapter({ ok: true }),
    })
    const res = await handler(makeRequest({ ...validBody, title: '' }))
    expect(res.status).toBe(400)
  })

  it('rejects unknown feedback type with 400', async () => {
    const handler = createFeedbackHandler({
      adapter: makeAdapter({ ok: true }),
    })
    const res = await handler(
      makeRequest({ ...validBody, type: 'rant' as never })
    )
    expect(res.status).toBe(400)
  })

  it('drops honeypot-filled requests with a fake 200', async () => {
    const adapter = makeAdapter({ ok: true })
    const handler = createFeedbackHandler({ adapter })
    const res = await handler(makeRequest({ ...validBody, __hp: 'bot' }))
    expect(res.status).toBe(200)
    expect(adapter.submit).not.toHaveBeenCalled()
  })

  it('returns 502 when the adapter returns ok:false', async () => {
    const handler = createFeedbackHandler({
      adapter: makeAdapter({ ok: false, error: 'Linear is down' }),
    })
    const res = await handler(makeRequest(validBody))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe('Linear is down')
  })

  it('returns 502 when the adapter throws', async () => {
    const handler = createFeedbackHandler({
      adapter: {
        name: 'broken',
        submit: vi.fn().mockRejectedValue(new Error('boom')),
      },
    })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await handler(makeRequest(validBody))
    expect(res.status).toBe(502)
    consoleSpy.mockRestore()
  })

  it('rate-limits after maxPerWindow requests from the same IP', async () => {
    const handler = createFeedbackHandler({
      adapter: makeAdapter({ ok: true }),
      rateLimit: { maxPerWindow: 2, windowMs: 60_000 },
    })
    const headers = { 'x-forwarded-for': '5.5.5.5' }
    expect((await handler(makeRequest(validBody, headers))).status).toBe(200)
    expect((await handler(makeRequest(validBody, headers))).status).toBe(200)
    expect((await handler(makeRequest(validBody, headers))).status).toBe(429)
  })

  it('disables rate limiting when rateLimit=false', async () => {
    const handler = createFeedbackHandler({
      adapter: makeAdapter({ ok: true }),
      rateLimit: false,
    })
    const headers = { 'x-forwarded-for': '5.5.5.5' }
    for (let i = 0; i < 50; i++) {
      const res = await handler(makeRequest(validBody, headers))
      expect(res.status).toBe(200)
    }
  })

  it('strips the honeypot before passing to the adapter', async () => {
    const adapter = makeAdapter({ ok: true })
    const handler = createFeedbackHandler({ adapter })
    await handler(makeRequest(validBody))
    const args = (adapter.submit as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(args).not.toHaveProperty('__hp')
  })

  it('runs enrichPayload and merges into the payload', async () => {
    const adapter = makeAdapter({ ok: true })
    const handler = createFeedbackHandler({
      adapter,
      enrichPayload: () => ({
        userContext: { userId: 'authoritative-id' },
        metadata: { source: 'server' },
      }),
    })
    await handler(
      makeRequest({
        ...validBody,
        userContext: { userEmail: 'user@example.com' },
        metadata: { source: 'client' },
      })
    )
    const args = (adapter.submit as ReturnType<typeof vi.fn>).mock.calls[0][0]
    // Server enrichment overrides client values (last-write-wins).
    expect(args.userContext.userId).toBe('authoritative-id')
    // Client values that the server didn't touch are preserved.
    expect(args.userContext.userEmail).toBe('user@example.com')
    expect(args.metadata).toEqual({ source: 'server' })
  })

  it('does not fail submission when enrichPayload throws', async () => {
    const adapter = makeAdapter({ ok: true })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handler = createFeedbackHandler({
      adapter,
      enrichPayload: () => {
        throw new Error('enrichment broken')
      },
    })
    const res = await handler(makeRequest(validBody))
    expect(res.status).toBe(200)
    expect(adapter.submit).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
