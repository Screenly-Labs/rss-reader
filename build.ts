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

import { readFileSync } from 'node:fs'
import { Glob } from 'bun'
import { bundleJs, processCss } from '@screenly-labs/signage-kit/build'
import { run as syncFonts } from './sync-fonts'

const clientOnly = process.argv.includes('--client')

// Shared chrome CSS from @screenly-labs/signage-kit — the canonical @font-face
// set. Prepended to this app's raw main.css at build time (a raw-CSS Worker
// can't resolve a bare `@import`). NOT the kit's brand.css: this app carries the
// Screenly badge in its top rail, and a QR "scan to read" lockup already sits in
// the bottom-right corner, so the kit's fixed corner badge would overlap it. The
// badge stays in the rail (`.brand`, below); only the removal logic is shared.
const sharedCss = ['fonts.css']
  .map((f) => readFileSync(Bun.resolveSync(`@screenly-labs/signage-kit/styles/${f}`, import.meta.dir), 'utf8'))
  .join('\n')

// Vendor the Bun-managed webfonts into ./assets first.
await syncFonts()

// ---- Client JS bundle: main.ts -> main.js --------------------------------
// @screenly-labs/signage-kit bundles main.ts (inlining ./render, qrcode-generator,
// and the shared polyfills shim), lowers modern syntax (?., ??, spread) to the
// shared ES2017 floor so old engines can parse it, and emits an IIFE so the output
// stays a self-contained self-executing classic script loadable from a plain
// <script>.
try {
  await bundleJs('assets/static/js/main.ts', 'assets/static/js/main.js')
} catch (error) {
  console.error('✗ Failed to build assets/static/js/main.ts')
  console.error(error)
  process.exit(1)
}
console.log('✓ JS: assets/static/js/main.js (iife, es2017)')

// ---- CSS: down-level + minify in place (skipped for --client) ------------
// @screenly-labs/signage-kit down-levels the authored CSS to the shared floor,
// prepends the shared html.legacy kill-switch (includeDegraded), and minifies,
// writing back in place. url(/static/...) refs are left untouched.
if (!clientOnly) {
  for await (const path of new Glob('assets/static/styles/*.css').scan('.')) {
    try {
      const code = await processCss(`${sharedCss}\n${await Bun.file(path).text()}`, {
        includeDegraded: true,
        filename: path
      })
      await Bun.write(path, code)
    } catch (error) {
      console.error(`✗ Failed to build ${path}`)
      console.error(error)
      process.exit(1)
    }
    console.log(`✓ CSS: ${path}`)
  }
}

console.log(`Build complete${clientOnly ? ' (client JS only)' : ''}.`)
