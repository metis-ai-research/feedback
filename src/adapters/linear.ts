/**
 * Linear adapter — submits feedback as a Linear issue via GraphQL.
 *
 * Linear API auth note: the Authorization header is the raw API key, NOT
 * `Bearer <key>`. (https://developers.linear.app/docs/graphql/working-with-the-graphql-api)
 *
 * Screenshot handling: if `screenshotDataUrl` is present, we use Linear's
 * `fileUpload` mutation to get a presigned upload URL, PUT the bytes, and
 * embed the resulting `assetUrl` as a markdown image at the bottom of the
 * issue description. If anything in that chain fails we still create the
 * issue (without the screenshot) — losing the issue because the upload
 * failed would be worse than losing the screenshot.
 */

import type { FeedbackAdapter } from './types'
import type {
  FeedbackPayload,
  FeedbackResult,
  FeedbackType,
} from '../shared/types'

const LINEAR_GRAPHQL = 'https://api.linear.app/graphql'

export interface LinearAdapterOptions {
  /** Personal API key from https://linear.app/settings/api. */
  apiKey: string
  /** UUID of the team that should receive issues. */
  teamId: string
  /** Optional: pin all issues to a project under that team. */
  projectId?: string
  /**
   * Optional: map feedback types to Linear label IDs.
   * Each type can map to multiple labels (e.g. ['bug-id', 'customer-id']).
   */
  labelMap?: Partial<Record<FeedbackType, string[]>>
  /**
   * Optional default priority for created issues.
   * 0 = no priority, 1 = urgent, 2 = high, 3 = medium, 4 = low.
   */
  defaultPriority?: 0 | 1 | 2 | 3 | 4
  /**
   * Optional title prefix override per type. Defaults to `[BUG]`, etc.
   * Set `false` to disable prefixing.
   */
  titlePrefix?: Partial<Record<FeedbackType, string>> | false
}

const DEFAULT_PREFIX: Record<FeedbackType, string> = {
  bug: '[BUG]',
  feedback: '[FEEDBACK]',
  feature: '[FEATURE]',
}

export function linearAdapter(opts: LinearAdapterOptions): FeedbackAdapter {
  if (!opts.apiKey) throw new Error('linearAdapter: apiKey is required')
  if (!opts.teamId) throw new Error('linearAdapter: teamId is required')

  return {
    name: 'linear',
    async submit(payload: FeedbackPayload): Promise<FeedbackResult> {
      try {
        let screenshotMarkdown = ''
        if (payload.screenshotDataUrl) {
          const url = await uploadScreenshot(
            opts.apiKey,
            payload.screenshotDataUrl
          )
          if (url) {
            screenshotMarkdown = `\n\n---\n\n![Screenshot](${url})`
          }
        }

        const title = formatTitle(payload, opts)
        const description = formatDescription(payload) + screenshotMarkdown
        const labelIds = opts.labelMap?.[payload.type] ?? []

        const res = await fetch(LINEAR_GRAPHQL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: opts.apiKey,
          },
          body: JSON.stringify({
            query: `
              mutation IssueCreate($input: IssueCreateInput!) {
                issueCreate(input: $input) {
                  success
                  issue { id identifier url }
                }
              }
            `,
            variables: {
              input: {
                teamId: opts.teamId,
                projectId: opts.projectId,
                title,
                description,
                ...(labelIds.length > 0 ? { labelIds } : {}),
                ...(opts.defaultPriority !== undefined
                  ? { priority: opts.defaultPriority }
                  : {}),
              },
            },
          }),
        })

        if (!res.ok) {
          return {
            ok: false,
            error: `Linear API responded ${res.status}`,
          }
        }

        const json = (await res.json()) as {
          data?: {
            issueCreate?: {
              success: boolean
              issue?: { id: string; identifier: string; url: string }
            }
          }
          errors?: Array<{ message: string }>
        }

        if (json.errors?.length) {
          return {
            ok: false,
            error: json.errors[0]?.message ?? 'Linear GraphQL error',
          }
        }
        const issue = json.data?.issueCreate?.issue
        if (!issue) {
          return { ok: false, error: 'Linear did not return an issue' }
        }
        return { ok: true, ticketUrl: issue.url }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        }
      }
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function formatTitle(
  payload: FeedbackPayload,
  opts: LinearAdapterOptions
): string {
  if (opts.titlePrefix === false) return payload.title
  const customPrefix = opts.titlePrefix?.[payload.type]
  const prefix = customPrefix ?? DEFAULT_PREFIX[payload.type]
  return `${prefix} ${payload.title}`.trim()
}

function formatDescription(payload: FeedbackPayload): string {
  const ctx = payload.userContext
  const parts: string[] = [payload.description]

  const contextLines: string[] = []
  if (ctx?.userName || ctx?.userEmail) {
    contextLines.push(
      `- **From:** ${ctx.userName ?? '(no name)'}${
        ctx.userEmail ? ` <${ctx.userEmail}>` : ''
      }`
    )
  }
  if (ctx?.userId) contextLines.push(`- **User ID:** \`${ctx.userId}\``)
  if (ctx?.url) contextLines.push(`- **URL:** ${ctx.url}`)
  if (ctx?.appVersion) contextLines.push(`- **App version:** ${ctx.appVersion}`)
  if (ctx?.userAgent) contextLines.push(`- **User agent:** \`${ctx.userAgent}\``)
  if (ctx?.viewport) {
    contextLines.push(
      `- **Viewport:** ${ctx.viewport.width}×${ctx.viewport.height}`
    )
  }

  if (contextLines.length > 0) {
    parts.push('', '---', '', '**Context**', '', contextLines.join('\n'))
  }

  if (payload.metadata && Object.keys(payload.metadata).length > 0) {
    parts.push(
      '',
      '**Metadata**',
      '',
      '```json',
      JSON.stringify(payload.metadata, null, 2),
      '```'
    )
  }

  return parts.join('\n')
}

/**
 * Uploads a data-URL PNG to Linear via the fileUpload mutation and returns
 * the resulting public asset URL, or null if any step fails.
 */
async function uploadScreenshot(
  apiKey: string,
  dataUrl: string
): Promise<string | null> {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  const contentType = match[1] ?? 'image/png'
  const base64 = match[2] ?? ''
  if (!base64) return null

  let bytes: Uint8Array
  try {
    bytes = base64ToBytes(base64)
  } catch {
    return null
  }
  const filename = `feedback-screenshot-${Date.now()}.png`

  // Step 1: ask Linear for a presigned upload URL.
  const fileRes = await fetch(LINEAR_GRAPHQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({
      query: `
        mutation FileUpload($contentType: String!, $filename: String!, $size: Int!) {
          fileUpload(contentType: $contentType, filename: $filename, size: $size) {
            success
            uploadFile {
              uploadUrl
              assetUrl
              headers { key value }
            }
          }
        }
      `,
      variables: { contentType, filename, size: bytes.byteLength },
    }),
  })
  if (!fileRes.ok) return null

  const fileJson = (await fileRes.json()) as {
    data?: {
      fileUpload?: {
        success: boolean
        uploadFile?: {
          uploadUrl: string
          assetUrl: string
          headers?: Array<{ key: string; value: string }>
        }
      }
    }
  }
  const uf = fileJson.data?.fileUpload?.uploadFile
  if (!uf) return null

  // Step 2: PUT the bytes to the presigned URL with Linear-supplied headers.
  const headers: Record<string, string> = {}
  for (const h of uf.headers ?? []) headers[h.key] = h.value

  const putRes = await fetch(uf.uploadUrl, {
    method: 'PUT',
    headers,
    // Cast: fetch's Body type accepts Uint8Array at runtime.
    body: bytes as BodyInit,
  })
  if (!putRes.ok) return null
  return uf.assetUrl
}

function base64ToBytes(base64: string): Uint8Array {
  // Works in Node 18+ and modern browsers without polyfill.
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'))
  }
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
