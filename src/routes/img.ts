import { Hono } from 'hono'
import { IMAGE_MAX_WIDTH } from '../constants'
import { verify } from '../sign'

// Signed, in-Worker image transform. Resizes a feed image's bytes via the
// Cloudflare Images binding and caches the result. There is NO public
// /cdn-cgi/image endpoint — this route only acts on URLs the worker signed
// (HMAC), so it can't be used as an open image proxy. Any failure (bad sig
// aside) falls back to the original image so the screen still shows something.

const img = new Hono<{ Bindings: Env }>()

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; ScreenlyRSSReader/1.0; +https://rss.srly.io)',
  Accept: 'image/avif,image/webp,image/*,*/*'
}

const pickFormat = (accept: string): string => {
  if (accept.includes('image/avif')) return 'image/avif'
  if (accept.includes('image/webp')) return 'image/webp'
  return 'image/jpeg'
}

img.get('/', async (c) => {
  const u = c.req.query('u')
  const s = c.req.query('s')
  const key = c.env.IMAGE_SIGNING_KEY
  // Without a signing key or the Images binding, behave as if the route is off.
  if (!u || !s || !key || !c.env.IMAGES) return c.notFound()
  if (!(await verify(u, s, key))) return c.text('bad signature', 403)

  const format = pickFormat(c.req.header('accept') ?? '')
  const cache = (caches as unknown as { default: Cache }).default
  // Cache per (signed URL + negotiated format) so avif/webp/jpeg don't collide.
  const keyUrl = new URL(c.req.url)
  keyUrl.searchParams.set('_f', format)
  const cacheKey = new Request(keyUrl.toString(), c.req.raw)
  const hit = await cache.match(cacheKey)
  if (hit) return hit

  try {
    const upstream = await fetch(u, { headers: FETCH_HEADERS })
    if (!upstream.ok || !upstream.body) return Response.redirect(u, 302)

    const result = await c.env.IMAGES.input(upstream.body)
      .transform({ width: IMAGE_MAX_WIDTH, fit: 'scale-down' })
      .output({ format, quality: 80 })

    const transformed = result.response()
    const response = new Response(transformed.body, transformed)
    // Content-addressed (signed URL + fixed params), so cache it hard.
    response.headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()))
    return response
  } catch (e) {
    console.log(`img transform failed for ${u}: ${e}`)
    return Response.redirect(u, 302)
  }
})

export default img
