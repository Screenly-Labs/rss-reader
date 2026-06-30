#!/usr/bin/env bun
// Builds the static assets. Unlike a JS project, the client source is
// TypeScript (assets/static/js/main.ts + render.ts) and browsers can't run TS,
// so this step is what produces the *served* file:
//
//   assets/static/js/main.ts  --bundle+minify-->  assets/static/js/main.js
//
// main.ts is the only JS *entry*. It imports ./render (the unit-tested pure
// helpers), and `external: []` tells Bun to inline that import, so the emitted
// main.js is a self-executing classic script with no `export` token — loadable
// by every cached HTML variant (plain <script> or type="module"). render.ts is
// a dependency, not an entry, so it is never built/served on its own.
//
// The emitted main.js is a build artifact (gitignored). CSS is minified in
// place (it is authored and served at the same path); pass --client to skip the
// CSS step (used by `bun run dev`, which only needs the JS bundle, so the
// working-tree CSS stays unminified for editing).

import { Glob } from 'bun'
import { run as syncFonts } from './sync-fonts'

const clientOnly = process.argv.includes('--client')

// Vendor the Bun-managed webfonts into ./assets first.
await syncFonts()

// ---- Client JS bundle: main.ts -> main.js --------------------------------
const jsResult = await Bun.build({
  entrypoints: ['assets/static/js/main.ts'],
  minify: true,
  target: 'browser',
  external: []
})

if (!jsResult.success) {
  console.error('✗ Failed to build assets/static/js/main.ts')
  for (const message of jsResult.logs) console.error(message)
  process.exit(1)
}

await Bun.write('assets/static/js/main.js', await jsResult.outputs[0].text())
console.log('✓ JS: assets/static/js/main.js (bundled from main.ts)')

// ---- CSS: minify in place (skipped for --client) -------------------------
if (!clientOnly) {
  const cssEntries: string[] = []
  for await (const path of new Glob('assets/static/styles/*.css').scan('.')) {
    cssEntries.push(path)
  }

  for (const path of cssEntries) {
    const result = await Bun.build({
      entrypoints: [path],
      minify: true,
      target: 'browser',
      // Leave url(/static/...) refs untouched rather than resolving them as
      // build-time assets.
      external: ['*']
    })

    if (!result.success) {
      console.error(`✗ Failed to build ${path}`)
      for (const message of result.logs) console.error(message)
      process.exit(1)
    }

    await Bun.write(path, await result.outputs[0].text())
    console.log(`✓ CSS: ${path}`)
  }
}

console.log(`Build complete${clientOnly ? ' (client JS only)' : ''}.`)
