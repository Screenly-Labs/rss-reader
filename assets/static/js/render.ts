// Pure, DOM-free helpers for the client, extracted so they can be unit-tested
// directly (test/render.test.ts). main.ts stays an export-free, self-executing
// browser script; build.ts inlines this module into the served bundle.

// Human "time ago" for an item's publish date. `nowMs` is injected (not read
// from the clock) so the formatting is deterministic and testable.
export const relativeTime = (epochMs: number | null, nowMs: number): string => {
  if (epochMs === null || !Number.isFinite(epochMs)) return ''
  const seconds = Math.max(0, Math.round((nowMs - epochMs) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(seconds / 3600)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(seconds / 86400)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(epochMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Bare host for an article URL ("https://www.nytimes.com/..." -> "nytimes.com").
// Empty string on anything unparseable.
export const hostLabel = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

// Largest n in [0, max] for which fits(n) is true, assuming fits is monotonic
// (true for small n, false once content overflows). This is the core of the
// fit-to-canvas pass: main.ts supplies a predicate that sets the summary to the
// first n words and measures overflow, and this returns the most words that
// still fit the fixed panel. Pure: the predicate does the measuring.
export const largestFit = (max: number, fits: (n: number) => boolean): number => {
  if (max <= 0) return 0
  if (fits(max)) return max
  let lo = 0
  let hi = max
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (fits(mid)) lo = mid
    else hi = mid
  }
  return lo
}
