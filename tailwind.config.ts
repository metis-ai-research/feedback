import type { Config } from 'tailwindcss'

/**
 * Tailwind config used at build time to generate `dist/styles.css`. Runs
 * via the `tailwindcss` CLI as a tsup `onSuccess` hook — see tsup.config.ts.
 *
 * Notes:
 *   - We deliberately omit `@tailwind base;` from the input CSS so this
 *     stylesheet does NOT reset the consuming app's styles. We only ship
 *     the utility classes our JSX uses.
 *   - No `prefix` — the widget uses standard Tailwind utility names. If a
 *     consumer has heavily overridden Tailwind defaults (e.g. redefined
 *     `bg-white`), they can either import this CSS *before* their globals
 *     so their overrides win, or open an issue and we'll add a `mfb-`
 *     prefix in v0.2.
 */
const config: Config = {
  content: ['./src/client/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  // Skip preflight (the `base` reset) — we don't want to clobber consumer styles.
  corePlugins: {
    preflight: false,
  },
}

export default config
