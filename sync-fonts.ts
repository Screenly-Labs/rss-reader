#!/usr/bin/env bun
// Copies the self-hosted webfont files out of the Bun-managed @fontsource
// packages and into ./assets/static/fonts, where wrangler's [site] config
// serves them at /static/fonts/. Bun owns the font versions (package.json);
// this step vendors the exact files we ship and serve ourselves — no CDN.
//
// "The Wire" type system: Bricolage Grotesque (variable opsz+wght "standard"
// axis) for headlines, Hanken Grotesk for body, Space Mono (400/700) as the
// teletype/utility face for the wire rail, datelines, and the QR label.

const FONTS = [
  '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-standard-normal.woff2',
  '@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2',
  '@fontsource/space-mono/files/space-mono-latin-400-normal.woff2',
  '@fontsource/space-mono/files/space-mono-latin-700-normal.woff2'
]
const DEST_DIR = 'assets/static/fonts'

export const run = async (): Promise<void> => {
  let count = 0

  for (const rel of FONTS) {
    const file = rel.split('/').pop()
    const src = Bun.file(`node_modules/${rel}`)

    if (!(await src.exists())) {
      console.error(`✗ Missing ${file} — run \`bun install\` first.`)
      process.exit(1)
    }

    await Bun.write(`${DEST_DIR}/${file}`, src)
    console.log(`✓ Font: ${DEST_DIR}/${file}`)
    count++
  }

  console.log(`Fonts synced — ${count} file(s) vendored from @fontsource.`)
}

// Allow running standalone: `bun run sync-fonts.ts`
if (import.meta.main) {
  await run()
}
