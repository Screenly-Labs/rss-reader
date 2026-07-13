#!/usr/bin/env bun
// Vendor this app's webfonts into ./assets/static/fonts. The files, versions,
// and copy logic all live in @screenly-labs/signage-kit — this just names the
// families "The Wire" uses: Bricolage Grotesque headlines, Hanken Grotesk body,
// Space Mono (400/700) for the wire rail / datelines / QR stamp.

import { syncFonts } from '@screenly-labs/signage-kit/sync-fonts'

export const run = (): Promise<number> =>
  syncFonts(['bricolage-grotesque', 'hanken-grotesk', 'space-mono'])

if (import.meta.main) {
  await run()
}
