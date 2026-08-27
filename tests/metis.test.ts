import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMetisFeedbackClient,
  failureKindFor,
  DEFAULT_MESSAGES,
  METIS_ENDPOINT,
  FEEDBACK_CATEGORIES,
  isFeedbackCategory,
} from '../src/metis'

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
  vi.clearAllMocks()
})

const mockFetch = (impl: any) => {
  global.fetch = vi.fn(impl) as any
}

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

const client = (over: Partial<Parameters<typeof createMetisFeedbackClient>[0]> = {}) =>
  createMetisFeedbackClient({ source: 'blinc-site', key: 'fbk_blinc-site_test', ...over })

describe('the vocabulary', () => {
  it('is the agreed six, in a stable order', () => {
    expect([...FEEDBACK_CATEGORIES]).toEqual(['bug', 'feature', 'feedback', 'question', 'payment', 'other'])
  })

  it('recognises canonical keys and rejects the spellings they replaced', () => {
    for (const key of FEEDBACK_CATEGORIES) expect(isFeedbackCategory(key)).toBe(true)
    // The four vocabularies this package exists to collapse. If any of these
    // ever passes, someone has re-added a per-project spelling.
    for (const old of ['technical-issues', 'general-inquiries', 'general', 'suggestions-feedback', 'payment-issues']) {
      expect(isFeedbackCategory(old)).toBe(false)
    }
    for (const bad of ['', 'BUG', null, undefined, 7, {}]) expect(isFeedbackCategory(bad)).toBe(false)
  })
})

describe('createMetisFeedbackClient', () => {
  it('refuses to build without a source or a key', () => {
    expect(() => createMetisFeedbackClient({ source: '', key: 'k' })).toThrow(/source/)
    expect(() => createMetisFeedbackClient({ source: 's', key: '' })).toThrow(/key/)
  })

  it('sends the contract shape, to the contract endpoint', async () => {
    let url: string | null = null
    let body: any = null
    mockFetch(async (u: string, init: any) => {
      url = u
      body = JSON.parse(init.body)
      return json(200, { ok: true, data: { ticketUrl: 'https://linear.app/x' } })
    })

    const res = await client().send({
      category: 'bug',
      content: '  it broke  ',
      name: '  Riku  ',
      email: '  riku@example.com  ',
    })

    expect(url).toBe(METIS_ENDPOINT)
    expect(body.source).toBe('blinc-site')
    expect(body.key).toBe('fbk_blinc-site_test')
    expect(body.kind).toBe('site')
    expect(body.category).toBe('bug')
    // Trimmed, so a stray space cannot make a required field look present.
    expect(body.content).toBe('it broke')
    expect(body.name).toBe('Riku')
    expect(body.email).toBe('riku@example.com')
    expect(res).toEqual({ ok: true, ticketUrl: 'https://linear.app/x' })
  })

  it('omits name and email rather than sending empty strings', async () => {
    let body: any = null
    mockFetch(async (_u: string, init: any) => {
      body = JSON.parse(init.body)
      return json(200, { ok: true })
    })

    await client({ kind: 'app' }).send({ category: 'bug', content: 'x', email: '   ' })
    expect('email' in body && body.email !== undefined).toBe(false)
    expect(body.name).toBeUndefined()
    expect(body.kind).toBe('app')
  })

  it('never sends a routing field, however convenient it would be', async () => {
    // The bound on a leaked public key is that it cannot pick a team, a label
    // or an assignee. That holds only while the payload has no such field.
    let body: any = null
    mockFetch(async (_u: string, init: any) => {
      body = JSON.parse(init.body)
      return json(200, { ok: true })
    })

    await client().send({ category: 'bug', content: 'x', name: 'R', email: 'a@b.com' })
    for (const forbidden of ['team', 'teamId', 'label', 'labels', 'assignee', 'project', 'projectId']) {
      expect(body[forbidden]).toBeUndefined()
    }
  })

  it('rejects a non-canonical category without a round trip', async () => {
    const fetchSpy = vi.fn()
    mockFetch(fetchSpy)
    const res = await client().send({ category: 'technical-issues' as any, content: 'x' })
    expect(res).toEqual({ ok: false, kind: 'invalid', error: DEFAULT_MESSAGES.invalid })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('treats a 200 whose envelope says otherwise as a failure', async () => {
    mockFetch(async () => json(200, { ok: false, error: 'nope' }))
    const res = await client().send({ category: 'bug', content: 'x', name: 'R', email: 'a@b.com' })
    expect(res.ok).toBe(false)
  })

  it('never surfaces the server’s own error string', async () => {
    // Metis OS's `error` is an English telemetry marker. Rendering it put
    // debugging text in front of Japanese and Korean readers, which is the
    // whole reason this client picks the copy.
    mockFetch(async () => json(503, { ok: false, error: 'linear credential did not resolve' }))
    const res = await client().send({ category: 'bug', content: 'x', name: 'R', email: 'a@b.com' })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.error).toBe(DEFAULT_MESSAGES.server)
    expect(res.error).not.toContain('credential')
    expect(res.status).toBe(503)
  })

  it('takes the caller’s copy when given, so a localized app stays localized', async () => {
    mockFetch(async () => json(500, { ok: false }))
    const res = await client({ messages: { server: '送信できませんでした。' } }).send({
      category: 'bug',
      content: 'x',
      name: 'R',
      email: 'a@b.com',
    })
    if (res.ok) throw new Error('unreachable')
    expect(res.error).toBe('送信できませんでした。')
  })

  it('maps a thrown fetch to offline rather than propagating', async () => {
    mockFetch(async () => {
      throw new Error('Network request failed')
    })
    const res = await client().send({ category: 'bug', content: 'x', name: 'R', email: 'a@b.com' })
    expect(res).toEqual({ ok: false, kind: 'offline', error: DEFAULT_MESSAGES.offline })
  })

  it('survives a non-JSON body instead of throwing', async () => {
    mockFetch(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
    }))
    const res = await client().send({ category: 'bug', content: 'x', name: 'R', email: 'a@b.com' })
    expect(res).toMatchObject({ ok: false, kind: 'server' })
  })
})

describe('failureKindFor', () => {
  it('calls a 4xx invalid, because the same input will fail again', () => {
    expect(failureKindFor(400)).toBe('invalid')
    expect(failureKindFor(403)).toBe('invalid')
    expect(failureKindFor(413)).toBe('invalid')
  })

  it('calls 429 and 5xx server, because the same input succeeds later', () => {
    expect(failureKindFor(429)).toBe('server')
    expect(failureKindFor(500)).toBe('server')
    expect(failureKindFor(503)).toBe('server')
  })

  it('calls 404 server, because it is our configuration and not their input', () => {
    // Unknown slug, wrong key, or source disabled — all answer 404 by design,
    // and none of them are something the person typing can fix.
    expect(failureKindFor(404)).toBe('server')
  })
})
