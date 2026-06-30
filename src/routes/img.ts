import { Hono } from 'hono'
import { IMAGE_MAX_WIDTH } from '../constants'
import { verify } from '../sign'

// Signed redirect to an external resizer (wsrv.nl / images.weserv.nl).
//
// We can't resize in-Worker (the Cloudflare Images binding isn't available on
// this account's billing plan) and we can't proxy wsrv through the Worker
// either — wsrv returns 403 to Cloudflare Worker subrequests. So /img verifies
// the HMAC and 302-redirects the *browser* to the optimized image. Only URLs the
// worker signed (in feed.ts) are honored, so this isn't an open redirector;
// wsrv caches the resized result on its own CDN.

const img = new Hono<{ Bindings: Env }>()

// wsrv serves webp (broadly supported, incl. signage Chromium) but not avif
// (output=avif → HTTP 400); fall back to jpg for clients without webp.
const pickFormat = (accept: string): string => (accept.includes('image/webp') ? 'webp' : 'jpg')

// Build the wsrv resize URL. https sources use the `ssl:` scheme prefix;
// `we` = never enlarge (don't upscale originals already under our width cap).
const resizeUrl = (source: string, format: string): string => {
  const host = source.replace(/^https:\/\//, 'ssl:').replace(/^http:\/\//, '')
  const q = new URLSearchParams({
    url: host,
    w: String(IMAGE_MAX_WIDTH),
    we: '',
    q: '80',
    output: format
  })
  return `https://wsrv.nl/?${q.toString()}`
}

img.get('/', async (c) => {
  const u = c.req.query('u')
  const s = c.req.query('s')
  const key = c.env.IMAGE_SIGNING_KEY
  // Without a signing key, behave as if the route is off (images served raw).
  if (!u || !s || !key) return c.notFound()
  if (!(await verify(u, s, key))) return c.text('bad signature', 403)

  const target = resizeUrl(u, pickFormat(c.req.header('accept') ?? ''))
  // Let the browser cache the redirect so it doesn't re-hit /img every rotation.
  c.header('Cache-Control', 'public, max-age=86400')
  return c.redirect(target, 302)
})

export default img
