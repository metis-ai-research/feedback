import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  FeedbackPayload,
  FeedbackResult,
  FeedbackType,
} from '../shared/types'
import {
  BugIcon,
  CameraIcon,
  CheckIcon,
  CloseIcon,
  MessageIcon,
  SendIcon,
  SparkleIcon,
} from './icons'

export interface FeedbackUser {
  id?: string
  email?: string
  name?: string
}

export interface FeedbackWidgetProps {
  /** Path/URL of your server route, e.g. `/api/feedback`. */
  endpoint: string
  /** Authenticated user — flows through to the ticket. */
  user?: FeedbackUser
  /** Application version (git SHA, semver) — useful for bug correlation. */
  appVersion?: string
  /** Free-form context attached to every submission from this app. */
  metadata?: Record<string, unknown>
  /** Where the trigger button sits. `inline` skips the FAB. */
  position?: 'bottom-right' | 'bottom-left' | 'inline'
  /** Trigger button label (defaults to `Feedback`). */
  triggerLabel?: string
  /** Pre-selected feedback type. */
  defaultType?: FeedbackType
  /** Hide the trigger entirely; use `controlledOpen` to drive the modal. */
  hideTrigger?: boolean
  /** Externally control whether the modal is open. */
  controlledOpen?: boolean
  /** Called when the user closes the modal (via X, Esc, or after success). */
  onClose?: () => void
  /** Called after a successful submission. */
  onSuccess?: (result: { ticketUrl?: string }) => void
  /** Optional class for the trigger button. */
  className?: string
}

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'capturing' }
  | { kind: 'success'; ticketUrl?: string }
  | { kind: 'error'; message: string }

const TYPE_OPTIONS: Array<{
  value: FeedbackType
  label: string
  helper: string
  Icon: typeof BugIcon
}> = [
  { value: 'bug', label: 'Bug', helper: "Something's broken", Icon: BugIcon },
  {
    value: 'feedback',
    label: 'Feedback',
    helper: 'General thoughts',
    Icon: MessageIcon,
  },
  {
    value: 'feature',
    label: 'Feature',
    helper: 'I wish it could…',
    Icon: SparkleIcon,
  },
]

export function FeedbackWidget(props: FeedbackWidgetProps) {
  const {
    endpoint,
    user,
    appVersion,
    metadata,
    position = 'bottom-right',
    triggerLabel = 'Feedback',
    defaultType = 'feedback',
    hideTrigger = false,
    controlledOpen,
    onClose,
    onSuccess,
    className,
  } = props

  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setInternalOpen(next)
      if (!next) onClose?.()
    },
    [controlledOpen, onClose]
  )

  const [type, setType] = useState<FeedbackType>(defaultType)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | undefined>(
    undefined
  )
  const [honeypot, setHoneypot] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Reset form when modal closes (after a tick so the close anim finishes).
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setType(defaultType)
        setTitle('')
        setDescription('')
        setScreenshotDataUrl(undefined)
        setHoneypot('')
        setStatus({ kind: 'idle' })
      }, 150)
      return () => clearTimeout(t)
    }
    // Focus the title input when opening.
    const t = setTimeout(() => titleInputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [open, defaultType])

  // Esc-to-close.
  useEffect(() => {
    if (!open) return
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, setOpen])

  const captureScreenshot = useCallback(async () => {
    if (typeof window === 'undefined') return
    setStatus({ kind: 'capturing' })
    try {
      // Lazy-import so SSR doesn't try to evaluate browser-only modules.
      const mod = await import('modern-screenshot')
      // Hide the modal via a data attribute the dialog reads, then yield
      // two frames so the browser actually paints without it before capture.
      dialogRef.current?.setAttribute('data-capturing', 'true')
      await new Promise(r => requestAnimationFrame(r))
      await new Promise(r => requestAnimationFrame(r))
      const dataUrl = await mod.domToPng(document.body, {
        backgroundColor: '#ffffff',
        scale: Math.min(window.devicePixelRatio || 1, 2),
      })
      setScreenshotDataUrl(dataUrl)
      setStatus({ kind: 'idle' })
    } catch (err) {
      console.error('[@metis/feedback] screenshot capture failed', err)
      setStatus({
        kind: 'error',
        message: "Couldn't capture screenshot. You can still submit without it.",
      })
    } finally {
      dialogRef.current?.removeAttribute('data-capturing')
    }
  }, [])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!title.trim() || !description.trim()) return
      setStatus({ kind: 'submitting' })

      const viewport =
        typeof window !== 'undefined'
          ? { width: window.innerWidth, height: window.innerHeight }
          : undefined
      const url =
        typeof window !== 'undefined' ? window.location.href : undefined
      const userAgent =
        typeof navigator !== 'undefined' ? navigator.userAgent : undefined

      const payload: FeedbackPayload & { __hp?: string } = {
        type,
        title: title.trim(),
        description: description.trim(),
        screenshotDataUrl,
        userContext: {
          url,
          userAgent,
          userId: user?.id,
          userEmail: user?.email,
          userName: user?.name,
          appVersion,
          viewport,
        },
        metadata,
        __hp: honeypot,
      }

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = (await res.json().catch(() => ({}))) as FeedbackResult
        if (!res.ok || !data.ok) {
          setStatus({
            kind: 'error',
            message: data.error || 'Something went wrong. Please try again.',
          })
          return
        }
        setStatus({ kind: 'success', ticketUrl: data.ticketUrl })
        onSuccess?.({ ticketUrl: data.ticketUrl })
      } catch (err) {
        setStatus({
          kind: 'error',
          message:
            err instanceof Error
              ? err.message
              : 'Network error. Please try again.',
        })
      }
    },
    [
      type,
      title,
      description,
      screenshotDataUrl,
      honeypot,
      endpoint,
      user,
      appVersion,
      metadata,
      onSuccess,
    ]
  )

  const renderTrigger = () => {
    if (hideTrigger) return null
    const positionClasses =
      position === 'bottom-right'
        ? 'fixed bottom-4 right-4 z-[60]'
        : position === 'bottom-left'
        ? 'fixed bottom-4 left-4 z-[60]'
        : ''
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${positionClasses} inline-flex items-center gap-2 rounded-full bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${className ?? ''}`}
        aria-label="Open feedback form"
      >
        <MessageIcon size={15} />
        {triggerLabel}
      </button>
    )
  }

  return (
    <>
      {renderTrigger()}
      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="metis-feedback-title"
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 data-[capturing=true]:invisible"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          {/* Dialog body */}
          <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4 rounded-t-2xl">
              <h2
                id="metis-feedback-title"
                className="text-lg font-bold text-gray-900"
              >
                {status.kind === 'success' ? 'Thanks!' : 'Send feedback'}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                aria-label="Close"
              >
                <CloseIcon size={18} />
              </button>
            </div>

            {status.kind === 'success' ? (
              <div className="px-6 py-8 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600">
                  <CheckIcon size={24} />
                </div>
                <p className="mb-2 text-base font-semibold text-gray-900">
                  We got it.
                </p>
                <p className="mb-6 text-sm text-gray-600">
                  Your feedback is queued for review. Thanks for taking the time.
                </p>
                {status.ticketUrl && (
                  <a
                    href={status.ticketUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-blue-600 hover:underline"
                  >
                    View on Linear &rarr;
                  </a>
                )}
                <div className="mt-6">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="px-6 py-5">
                {/* Type selector */}
                <fieldset className="mb-5">
                  <legend className="mb-2 block text-sm font-medium text-gray-700">
                    What kind of feedback?
                  </legend>
                  <div className="grid grid-cols-3 gap-2">
                    {TYPE_OPTIONS.map(opt => {
                      const selected = type === opt.value
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setType(opt.value)}
                          aria-pressed={selected}
                          className={`flex flex-col items-center gap-1 rounded-xl border-2 p-3 text-left transition-all ${
                            selected
                              ? 'border-gray-900 bg-gray-50'
                              : 'border-gray-200 bg-white hover:border-gray-400'
                          }`}
                        >
                          <opt.Icon
                            size={18}
                            className={
                              selected ? 'text-gray-900' : 'text-gray-500'
                            }
                          />
                          <span
                            className={`text-xs font-semibold ${
                              selected ? 'text-gray-900' : 'text-gray-700'
                            }`}
                          >
                            {opt.label}
                          </span>
                          <span className="text-[10px] text-gray-500">
                            {opt.helper}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </fieldset>

                {/* Title */}
                <div className="mb-4">
                  <label
                    htmlFor="metis-feedback-input-title"
                    className="mb-1.5 block text-sm font-medium text-gray-700"
                  >
                    Summary <span className="text-red-500">*</span>
                  </label>
                  <input
                    ref={titleInputRef}
                    id="metis-feedback-input-title"
                    type="text"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    maxLength={200}
                    required
                    placeholder={
                      type === 'bug'
                        ? 'e.g., Save button is unresponsive'
                        : type === 'feature'
                        ? 'e.g., Bulk-import stakeholders from CSV'
                        : 'e.g., Loving the new wizard flow'
                    }
                    className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  />
                </div>

                {/* Description */}
                <div className="mb-4">
                  <label
                    htmlFor="metis-feedback-input-description"
                    className="mb-1.5 block text-sm font-medium text-gray-700"
                  >
                    Details <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    id="metis-feedback-input-description"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    maxLength={10_000}
                    required
                    rows={5}
                    placeholder={
                      type === 'bug'
                        ? 'What were you doing? What did you expect to happen?'
                        : 'Tell us more…'
                    }
                    className="block w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  />
                </div>

                {/* Screenshot */}
                <div className="mb-5">
                  {screenshotDataUrl ? (
                    <div className="relative overflow-hidden rounded-lg border border-gray-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={screenshotDataUrl}
                        alt="Captured screenshot"
                        className="block w-full max-h-40 object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => setScreenshotDataUrl(undefined)}
                        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/90"
                        aria-label="Remove screenshot"
                      >
                        <CloseIcon size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={captureScreenshot}
                      disabled={status.kind === 'capturing'}
                      className="inline-flex items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 hover:border-gray-400 hover:bg-gray-100 disabled:opacity-60"
                    >
                      <CameraIcon size={15} />
                      {status.kind === 'capturing'
                        ? 'Capturing…'
                        : 'Attach screenshot of this page'}
                    </button>
                  )}
                </div>

                {/* Honeypot — invisible to humans, fillable by bots */}
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: '-10000px',
                    width: '1px',
                    height: '1px',
                    overflow: 'hidden',
                  }}
                >
                  <label>
                    Don&apos;t fill this in
                    <input
                      type="text"
                      tabIndex={-1}
                      autoComplete="off"
                      value={honeypot}
                      onChange={e => setHoneypot(e.target.value)}
                    />
                  </label>
                </div>

                {/* Error */}
                {status.kind === 'error' && (
                  <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {status.message}
                  </div>
                )}

                {/* Submit */}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-gray-500">
                    {user?.email
                      ? `Sending as ${user.email}`
                      : 'Sending anonymously'}
                  </p>
                  <button
                    type="submit"
                    disabled={
                      status.kind === 'submitting' ||
                      !title.trim() ||
                      !description.trim()
                    }
                    className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {status.kind === 'submitting' ? (
                      <>
                        <Spinner />
                        Sending…
                      </>
                    ) : (
                      <>
                        <SendIcon size={14} />
                        Send
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}
