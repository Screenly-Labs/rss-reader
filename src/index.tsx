import { Hono } from 'hono'
import { cache } from 'hono/cache'
import { serveStatic } from 'hono/cloudflare-workers'
import { logger } from 'hono/logger'
import manifest from '__STATIC_CONTENT_MANIFEST'
import App from './components/App'
import { FEED_CACHE_TTL_SECONDS, FEED_PARAM } from './constants'
import { defaultFeed, getFeed } from './feeds'
import { manifest as appManifest } from './manifest'
import feed from './routes/feed'
import img from './routes/img'

const app = new Hono<{ Bindings: Env }>()

// A short, deploy-stable token derived from the hashed static-asset manifest.
// It changes whenever any asset (JS/CSS/font) changes, which is exactly when a
// deploy ships. Folding it into the page-cache key means a new deploy lands on
// a fresh key instead of serving a previously cached HTML shell that points at
// the previous build's assets.
const ASSET_VERSION = (() => {
  const source = typeof manifest === 'string' ? manifest : JSON.stringify(manifest)
  let hash = 0
  for (let i = 0; i < source.length; i++) {
    hash = (Math.imul(31, hash) + source.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
})()

app.use('*', logger())

// Asset URLs in the HTML carry ?v=<version>, so a versioned request is safe to
// cache forever; legacy unversioned URLs get a short TTL so cached HTML can pick
// up the current bundle. Fonts are an exception: their @font-face URLs are
// intentionally unversioned (and woff2 filenames are content-stable), so cache
// them immutably too — otherwise a 24/7 screen re-downloads them every 5 min.
app.use('/static/*', async (c, next) => {
  await next()
  const versioned = c.req.query('v') !== undefined
  const isFont = c.req.path.startsWith('/static/fonts/')
  c.header(
    'Cache-Control',
    versioned || isFont ? 'public, max-age=31536000, immutable' : 'public, max-age=300'
  )
})
app.use('/static/*', serveStatic({ root: './', manifest }))

// The self-describing app manifest, served at a stable well-known path. The app
// store and signage players fetch this cross-origin, so it must carry
// `Access-Control-Allow-Origin: *` and stay anonymously reachable. See
// src/manifest.ts and `docs/app-manifest.md` in the sibling
// `Screenly-Labs/app-store` repo.
app.get('/.well-known/signage-app.json', (c) => {
  c.header('Access-Control-Allow-Origin', '*')
  c.header('Cache-Control', `public, max-age=${FEED_CACHE_TTL_SECONDS}`)
  return c.json(appManifest)
})

app.get('/', async (c) => {
  const id = c.req.query(FEED_PARAM)
  const selected = getFeed(id)

  // Canonicalize: a missing or unknown feed id redirects to the default feed,
  // so the render path (and the page-cache key) always has a known feed.
  if (!selected) {
    const url = new URL(c.req.url)
    url.searchParams.set(FEED_PARAM, defaultFeed().id)
    // 302 (not 301): a 301 is cached by players/proxies forever, which would
    // pin a screen to the old default after DEFAULT_FEED_ID or a feed id changes.
    return new Response(null, { status: 302, headers: { Location: url.toString() } })
  }

  const env = c.env.ENV
  const renderPage = (): Response =>
    new Response(
      (<App feedId={selected.id} feedTitle={selected.title} env={env} v={ASSET_VERSION} />).toString(),
      {
        status: 200,
        headers: {
          'Cache-Control': 's-maxage=43200',
          'Content-Type': 'text/html; charset=UTF-8'
        }
      }
    )

  // Only use the SSR page cache in deployed envs. In `wrangler dev` the static
  // asset manifest isn't content-hashed, so ASSET_VERSION (the cache key) is
  // stable across edits and the 12h cache would serve stale HTML against freshly
  // built CSS/JS. Rendering fresh every request locally keeps dev honest.
  if (!env) return renderPage()

  const pageCache = (caches as unknown as { default: Cache }).default
  // The Cache API needs a raw Request. Version the key by the deployed asset
  // bundle so each deploy busts the SSR page cache; the feed id is already part
  // of the URL, so feeds cache independently of one another.
  const keyUrl = new URL(c.req.url)
  keyUrl.searchParams.set('v', ASSET_VERSION)
  const key = new Request(keyUrl.toString(), c.req.raw)
  let response = await pageCache.match(key)

  if (!response) {
    response = renderPage()
    c.executionCtx.waitUntil(pageCache.put(key, response.clone()))
  }

  return response
})

// Cache each feed's parsed JSON at the edge (TTL shared with the client refresh
// cadence). The feed id is in the query string, so every source caches
// separately. Skipped in dev (no ENV) so parser/feed edits show immediately.
const feedCache = cache({
  cacheName: 'default',
  cacheControl: `s-maxage=${FEED_CACHE_TTL_SECONDS}`
})
app.get('/api/feed/*', (c, next) => (c.env.ENV ? feedCache(c, next) : next()))
app.route('/api/feed', feed)

// Signed image transform (resize + cache). No public /cdn-cgi/image surface.
app.route('/img', img)

export default app
