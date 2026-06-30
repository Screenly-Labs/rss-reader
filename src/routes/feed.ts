import { Hono } from 'hono'
import { FEED_PARAM } from '../constants'
import { defaultFeed, getFeed } from '../feeds'
import { parseFeed } from '../parse'

const feed = new Hono<{ Bindings: Env }>()

const UPSTREAM_TIMEOUT_MS = 10000

// Some publishers reject the default Workers fetch UA or a missing Accept; send
// a polite, identifiable UA and an RSS/Atom-friendly Accept header.
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; ScreenlyRSSReader/1.0; +https://rss.srly.io)',
  Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
}

const isTimeout = (err: unknown): boolean => {
  const name = (err as { name?: string } | null)?.name
  return name === 'AbortError' || name === 'TimeoutError'
}

const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal, headers: FETCH_HEADERS })
  } finally {
    clearTimeout(timer)
  }
}

feed.get('/', async (c) => {
  const id = c.req.query(FEED_PARAM)
  // An explicit but unknown id is a config error (surface it); a missing id
  // falls back to the default feed. In normal flow index.tsx has already
  // canonicalized ?feed=, so the missing-id branch only matters for direct
  // /api/feed access.
  const selected = id ? getFeed(id) : defaultFeed()
  if (!selected) return c.json({ error: true, reason: 'unknown feed' }, 404)

  try {
    const timeoutMs = Number(c.env.FEED_TIMEOUT_MS) || UPSTREAM_TIMEOUT_MS
    const resp = await fetchWithTimeout(selected.url, timeoutMs)

    if (!resp.ok) {
      console.log(`Feed ${selected.id} upstream returned ${resp.status} ${resp.statusText}`)
      return c.json({ error: true }, 502)
    }

    const xml = await resp.text()
    const parsed = parseFeed(xml, { baseUrl: selected.url })

    // A 200 that parses to nothing usually means the upstream served an HTML
    // error/maintenance page, not a real feed. Return 502 (which Hono's cache
    // middleware will NOT cache) rather than a 200 empty list that would be
    // edge-cached for an hour and strand every screen on "No stories".
    if (parsed.items.length === 0) {
      console.log(`Feed ${selected.id} parsed to 0 items`)
      return c.json({ error: true, reason: 'empty' }, 502)
    }

    return c.json({
      feed: { id: selected.id, title: selected.title, category: selected.category },
      // The feed's own <title> if present, else the curated registry title.
      title: parsed.title || selected.title,
      items: parsed.items
    })
  } catch (e) {
    console.log(e)
    const cause = (e as { cause?: unknown } | null)?.cause
    return c.json({ error: true }, isTimeout(e) || isTimeout(cause) ? 504 : 502)
  }
})

export default feed
