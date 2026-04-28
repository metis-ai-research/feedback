import { describe, it, expect, beforeEach, vi } from 'vitest'
import { linearAdapter } from '../src/adapters/linear'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

function issueSuccess(url = 'https://linear.app/team/issue/MET-1') {
  return {
    ok: true,
    json: async () => ({
      data: {
        issueCreate: {
          success: true,
          issue: { id: 'i1', identifier: 'MET-1', url },
        },
      },
    }),
  }
}

describe('linearAdapter — basics', () => {
  it('throws on missing apiKey or teamId', () => {
    expect(() => linearAdapter({ apiKey: '', teamId: 't' } as never)).toThrow()
    expect(() => linearAdapter({ apiKey: 'k', teamId: '' } as never)).toThrow()
  })

  it('creates an issue with prefixed title and returns ticketUrl', async () => {
    fetchMock.mockResolvedValueOnce(issueSuccess())
    const adapter = linearAdapter({ apiKey: 'lin_test', teamId: 'team-1' })
    const res = await adapter.submit({
      type: 'bug',
      title: 'Save button broken',
      description: 'Click does nothing.',
    })
    expect(res.ok).toBe(true)
    expect(res.ticketUrl).toBe('https://linear.app/team/issue/MET-1')
    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe('https://api.linear.app/graphql')
    const requestBody = JSON.parse(call[1].body)
    expect(requestBody.variables.input.title).toBe('[BUG] Save button broken')
    expect(requestBody.variables.input.teamId).toBe('team-1')
  })

  it('uses Authorization header without Bearer prefix', async () => {
    fetchMock.mockResolvedValueOnce(issueSuccess())
    const adapter = linearAdapter({ apiKey: 'lin_xyz', teamId: 'team-1' })
    await adapter.submit({
      type: 'feedback',
      title: 'Hi',
      description: 'Thanks',
    })
    const call = fetchMock.mock.calls[0]
    expect(call[1].headers.Authorization).toBe('lin_xyz')
    expect(call[1].headers.Authorization).not.toMatch(/^Bearer /)
  })

  it('passes labelIds when configured for this type', async () => {
    fetchMock.mockResolvedValueOnce(issueSuccess())
    const adapter = linearAdapter({
      apiKey: 'k',
      teamId: 't',
      labelMap: { bug: ['lbl-bug'] },
    })
    await adapter.submit({ type: 'bug', title: 'x', description: 'y' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.variables.input.labelIds).toEqual(['lbl-bug'])
  })

  it('omits labelIds when no labels configured for the type', async () => {
    fetchMock.mockResolvedValueOnce(issueSuccess())
    const adapter = linearAdapter({
      apiKey: 'k',
      teamId: 't',
      labelMap: { bug: ['lbl-bug'] }, // no entry for 'feature'
    })
    await adapter.submit({ type: 'feature', title: 'x', description: 'y' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.variables.input.labelIds).toBeUndefined()
  })

  it('honors custom titlePrefix and titlePrefix=false', async () => {
    fetchMock.mockResolvedValueOnce(issueSuccess())
    const a1 = linearAdapter({
      apiKey: 'k',
      teamId: 't',
      titlePrefix: { bug: '🐞' },
    })
    await a1.submit({ type: 'bug', title: 'broken', description: 'd' })
    let body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.variables.input.title).toBe('🐞 broken')

    fetchMock.mockResolvedValueOnce(issueSuccess())
    const a2 = linearAdapter({
      apiKey: 'k',
      teamId: 't',
      titlePrefix: false,
    })
    await a2.submit({ type: 'bug', title: 'plain', description: 'd' })
    body = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(body.variables.input.title).toBe('plain')
  })

  it('embeds user context as a markdown block in the description', async () => {
    fetchMock.mockResolvedValueOnce(issueSuccess())
    const adapter = linearAdapter({ apiKey: 'k', teamId: 't' })
    await adapter.submit({
      type: 'feedback',
      title: 'hi',
      description: 'first line',
      userContext: {
        userName: 'Mike',
        userEmail: 'mike@agency.com',
        url: 'https://app.example.com/dashboard',
        appVersion: '1.2.3',
      },
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    const desc = body.variables.input.description
    expect(desc).toContain('first line')
    expect(desc).toContain('Mike')
    expect(desc).toContain('mike@agency.com')
    expect(desc).toContain('1.2.3')
  })
})

describe('linearAdapter — error handling', () => {
  it('returns ok:false on Linear non-2xx', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
    const adapter = linearAdapter({ apiKey: 'k', teamId: 't' })
    const res = await adapter.submit({
      type: 'bug',
      title: 'x',
      description: 'y',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('401')
  })

  it('returns ok:false when GraphQL returns errors[]', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errors: [{ message: 'Team not found' }] }),
    })
    const adapter = linearAdapter({ apiKey: 'k', teamId: 't' })
    const res = await adapter.submit({
      type: 'bug',
      title: 'x',
      description: 'y',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('Team not found')
  })

  it('returns ok:false when the network call throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ENETUNREACH'))
    const adapter = linearAdapter({ apiKey: 'k', teamId: 't' })
    const res = await adapter.submit({
      type: 'bug',
      title: 'x',
      description: 'y',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('ENETUNREACH')
  })
})

describe('linearAdapter — screenshot upload', () => {
  it('still creates the issue when screenshot upload fails', async () => {
    // 1st fetch: fileUpload mutation returns a non-ok response
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    // 2nd fetch: issueCreate succeeds
    fetchMock.mockResolvedValueOnce(issueSuccess())

    const adapter = linearAdapter({ apiKey: 'k', teamId: 't' })
    const res = await adapter.submit({
      type: 'bug',
      title: 'x',
      description: 'y',
      screenshotDataUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
    })
    expect(res.ok).toBe(true)
    expect(res.ticketUrl).toBeDefined()
    // Description should NOT include a screenshot markdown image since upload failed
    const issueCreateBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(issueCreateBody.variables.input.description).not.toContain(
      '![Screenshot]'
    )
  })

  it('embeds an asset URL in the description when upload succeeds', async () => {
    // fileUpload mutation
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          fileUpload: {
            success: true,
            uploadFile: {
              uploadUrl: 'https://uploads.linear.app/presigned',
              assetUrl: 'https://uploads.linear.app/asset.png',
              headers: [{ key: 'x-amz-acl', value: 'public-read' }],
            },
          },
        },
      }),
    })
    // PUT to presigned URL
    fetchMock.mockResolvedValueOnce({ ok: true })
    // issueCreate
    fetchMock.mockResolvedValueOnce(issueSuccess())

    const adapter = linearAdapter({ apiKey: 'k', teamId: 't' })
    const res = await adapter.submit({
      type: 'bug',
      title: 'x',
      description: 'y',
      screenshotDataUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
    })
    expect(res.ok).toBe(true)
    const issueCreateBody = JSON.parse(fetchMock.mock.calls[2][1].body)
    expect(issueCreateBody.variables.input.description).toContain(
      '![Screenshot](https://uploads.linear.app/asset.png)'
    )
  })
})
