import { defineConfig } from 'tsup'

// Two configs because the client entry needs the `'use client'` banner so
// Next.js / RSC consumers treat the prebuilt output as a client component.
// The server + adapter entries must NOT have that banner — they're meant
// to run on the server.
//
// CSS pipeline: the client config's `onSuccess` invokes Tailwind's CLI on
// `src/client/styles.css`, scanning the widget JSX for utility classes,
// and emits a self-contained `dist/styles.css`. Consumers import that file
// once instead of adding the package path to their tailwind.config content.
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    external: ['react', 'react-dom'],
    banner: { js: "'use client';" },
    clean: true,
    target: 'es2022',
    sourcemap: true,
    onSuccess:
      'npx tailwindcss -c ./tailwind.config.ts -i ./src/client/styles.css -o ./dist/styles.css --minify',
  },
  {
    entry: {
      server: 'src/server.ts',
      'adapters/linear': 'src/adapters/linear.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    external: ['react', 'react-dom'],
    clean: false,
    target: 'es2022',
    sourcemap: true,
  },
])
