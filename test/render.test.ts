import { describe, expect, it } from 'bun:test'
import { hostLabel, largestFit, relativeTime } from '../assets/static/js/render'

// Fixed "now" so relative formatting is deterministic.
const NOW = Date.parse('2026-06-29T12:00:00Z')
const ago = (ms: number) => relativeTime(NOW - ms, NOW)

describe('relativeTime', () => {
  it('handles the recent buckets', () => {
    expect(ago(10_000)).toBe('just now')
    expect(ago(5 * 60_000)).toBe('5 min ago')
    expect(ago(3 * 3_600_000)).toBe('3 hr ago')
    expect(ago(24 * 3_600_000)).toBe('1 day ago')
    expect(ago(3 * 86_400_000)).toBe('3 days ago')
  })

  it('shows an absolute date past a week', () => {
    expect(ago(30 * 86_400_000)).toMatch(/May|Jun/)
  })

  it('returns empty string for a missing date', () => {
    expect(relativeTime(null, NOW)).toBe('')
  })
})

describe('hostLabel', () => {
  it('strips the www. prefix', () => {
    expect(hostLabel('https://www.nytimes.com/2026/06/x.html')).toBe('nytimes.com')
    expect(hostLabel('https://hnrss.org/frontpage')).toBe('hnrss.org')
  })

  it('returns empty string for an unparseable url', () => {
    expect(hostLabel('not a url')).toBe('')
  })
})

describe('largestFit', () => {
  // Monotonic predicate: everything up to a threshold "fits".
  const upTo = (threshold: number) => (n: number) => n <= threshold

  it('returns max when everything fits', () => {
    expect(largestFit(20, upTo(100))).toBe(20)
  })

  it('finds the largest fitting count', () => {
    expect(largestFit(20, upTo(7))).toBe(7)
    expect(largestFit(1000, upTo(613))).toBe(613)
  })

  it('returns 0 when nothing fits', () => {
    expect(largestFit(20, () => false)).toBe(0)
    expect(largestFit(0, () => true)).toBe(0)
  })
})
