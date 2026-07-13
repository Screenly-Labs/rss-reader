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
import browserslist from 'browserslist'
import { build as esbuild } from 'esbuild'
import { browserslistToTargets, transform as lightningcss } from 'lightningcss'
import { run as syncFonts } from './sync-fonts'

const clientOnly = process.argv.includes('--client')

// The `browserslist` field in package.json is the CSS support floor: Lightning
// CSS down-levels the stylesheet to it. The JS is lowered separately by esbuild to
// a fixed ES2017 syntax floor (kept at/below the browserslist minimum); esbuild
// can't read browserslist, so keep the two in sync if you change the floor. See
// the degraded-mode notes in Layout.tsx / main.css.
const cssTargets = browserslistToTargets(browserslist())

// Vendor the Bun-managed webfonts into ./assets first.
await syncFonts()

// ---- Client JS bundle: main.ts -> main.js --------------------------------
// esbuild bundles main.ts (inlining ./render, qrcode-generator, and the polyfills
// shim), lowers modern syntax (?., ??, spread) to the ES2017 floor so old engines
// can parse it, and emits an IIFE so the output stays a self-contained self-
// executing classic script loadable from a plain <script>.
try {
  await esbuild({
    entryPoints: ['assets/static/js/main.ts'],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2017'],
    outfile: 'assets/static/js/main.js'
  })
} catch (error) {
  console.error('✗ Failed to build assets/static/js/main.ts')
  console.error(error)
  process.exit(1)
}
console.log('✓ JS: assets/static/js/main.js (esbuild, iife, es2017)')

// ---- CSS: down-level + minify in place (skipped for --client) ------------
// Lightning CSS down-levels the authored CSS to the browserslist floor and
// minifies, writing back in place. url(/static/...) refs are left untouched.
if (!clientOnly) {
  const cssEntries: string[] = []
  for await (const path of new Glob('assets/static/styles/*.css').scan('.')) {
    cssEntries.push(path)
  }

  for (const path of cssEntries) {
    try {
      const { code } = lightningcss({
        filename: path,
        code: await Bun.file(path).bytes(),
        minify: true,
        targets: cssTargets
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
