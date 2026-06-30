import { Hono } from 'hono'
import { FEED_PARAM } from '../constants'
import { defaultFeed, getFeed } from '../feeds'
import { decodeEntities, type FeedItem, parseFeed } from '../parse'

const feed = new Hono<{ Bindings: Env }>()

const UPSTREAM_TIMEOUT_MS = 10000
// Article fetches (for og:image) get a tighter budget than the feed itself.
const ARTICLE_TIMEOUT_MS = 6000
// Cap images at this width via Cloudflare Image Resizing — covers 4K viewing at
// distance while cutting NASA-sized originals from multi-MB to a few hundred KB.
const IMAGE_MAX_WIDTH = 2560

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

// Pull the og:image URL out of an article's HTML (attribute order varies).
const OG_IMAGE_RE =
  /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i

const extractOgImage = (html: string): string | null => {
  const match = OG_IMAGE_RE.exec(html)
  if (!match) return null
  const url = match[1] ?? match[2] ?? ''
  return url ? decodeEntities(url) : null
}

// For items whose feed only gave a small thumbnail, fetch the article and use
// its og:image (a real, publisher-chosen high-res image) — resolved entirely
// server-side. Best-effort and parallel: any failure keeps the thumbnail. The
// 1-hour edge cache means this runs at most once per feed per hour.
const enrichImages = async (items: FeedItem[], timeoutMs: number): Promise<void> => {
  await Promise.all(
    items.map(async (item) => {
      if (item.lowResImage && item.link) {
        try {
          const resp = await fetchWithTimeout(item.link, timeoutMs)
          if (resp.ok) {
            const og = extractOgImage(await resp.text())
            if (og) item.image = og
          }
        } catch (e) {
          console.log(`og:image fetch failed for ${item.link}: ${e}`)
        }
      }
      item.lowResImage = undefined
    })
  )
}

// Route an image through Cloudflare Image Resizing: resized to our cap, served
// as AVIF/WebP, edge-cached, and never upscaled (fit=scale-down). onerror falls
// back to the original. Same-origin /cdn-cgi/image/ path — handled by the CF
// edge, so it only works in deployed envs (not wrangler dev).
const optimizeImageUrl = (url: string): string =>
  `/cdn-cgi/image/width=${IMAGE_MAX_WIDTH},quality=80,format=auto,fit=scale-down,onerror=redirect/${url}`

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

    // Resolve real higher-res images for items that only had a thumbnail.
    await enrichImages(parsed.items, Number(c.env.FEED_TIMEOUT_MS) || ARTICLE_TIMEOUT_MS)

    // Resize/optimize via Cloudflare Image Resizing — deployed envs only (the
    // /cdn-cgi/image/ edge feature isn't available in wrangler dev).
    if (c.env.ENV) {
      for (const item of parsed.items) {
        if (item.image && /^https?:\/\//.test(item.image)) {
          item.image = optimizeImageUrl(item.image)
        }
      }
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
