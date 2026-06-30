import { afterEach, describe, expect, it, mock } from 'bun:test'
import { jsx } from 'hono/jsx'
import App from './components/App'

// The Cloudflare static-assets middleware and its build-time manifest only
// exist in the Workers runtime; stub both before importing the app.
mock.module('__STATIC_CONTENT_MANIFEST', () => ({ default: '{}' }))
mock.module('hono/cloudflare-workers', () => ({
  serveStatic: () => async (_c: unknown, next: () => Promise<void>) => next()
}))

interface CacheLike {
  match: (k: Request | string) => Promise<Response | undefined>
  put: (k: Request | string, res: Response) => Promise<void>
}

const makeCache = (): CacheLike => {
  const store = new Map<string, Response>()
  const keyOf = (k: Request | string) => (typeof k === 'string' ? k : k.url)
  return {
    match: async (k) => store.get(keyOf(k))?.clone(),
    put: async (k, res) => {
      store.set(keyOf(k), res.clone())
    }
  }
}

// hono's cache() middleware reads globalThis.caches at module load; define it
// before importing the app so the real middleware is wired up.
const BASELINE_CACHE = { default: makeCache(), open: async () => makeCache() }
;(globalThis as unknown as { caches: unknown }).caches = BASELINE_CACHE

const app = (await import('.')).default
const ORIGINAL_FETCH = globalThis.fetch

const setCaches = (value: unknown) => {
  ;(globalThis as unknown as { caches: unknown }).caches = value
}
const runWaitUntil = async (promises: Promise<unknown>[]) => {
  await Promise.all(promises)
}

afterEach(() => {
  setCaches(BASELINE_CACHE)
  globalThis.fetch = ORIGINAL_FETCH
})

describe('Routing', () => {
  it('redirects a feed-less request to the default feed (302, not cacheable-forever)', async () => {
    const res = await app.request('http://localhost/')
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('feed=npr')
  })

  it('redirects an unknown feed id to the default feed', async () => {
    const res = await app.request('http://localhost/?feed=does-not-exist')
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toContain('feed=npr')
  })

  it('renders the page HTML via hono JSX for a known feed', () => {
    const body = jsx(App, { env: 'production', feedId: 'nyt', feedTitle: 'NYT', v: 'testver' }).toString()
    expect(body).toContain('<!DOCTYPE html>')
    expect(body).toContain('id="feed-data"')
    // main.ts drives everything off #stage; the contract must hold.
    expect(body).toContain('id="stage"')
    expect(body).toContain('data-feed-id="nyt"')
    expect(body).not.toContain('[object Object]')
    expect(body).toContain('<script src="/static/js/main.js?v=testver" async defer>')
    expect(body).toContain('/static/styles/main.css?v=testver')
  })

  it('omits Sentry / GA script tags when no analytics IDs are configured', () => {
    const body = jsx(App, { env: 'production', feedId: 'nyt', feedTitle: 'NYT', v: 'testver' }).toString()
    expect(body).not.toContain('sentry-cdn.com')
    expect(body).not.toContain('googletagmanager.com')
  })
})

describe('Page caching (/ route)', () => {
  it('renders a known feed on a cache miss with the edge Cache-Control and a versioned key', async () => {
    const keys: (Request | string)[] = []
    const puts: Promise<unknown>[] = []
    setCaches({
      default: {
        match: async (k: Request | string) => {
          keys.push(k)
          return undefined
        },
        put: async (k: Request | string) => {
          keys.push(k)
        }
      }
    })
    const ctx = { waitUntil: (p: Promise<unknown>) => puts.push(p), passThroughOnException() {}, props: {} }

    const res = await app.request('http://localhost/?feed=nyt', {}, { ENV: 'production' }, ctx)

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<!DOCTYPE html>')
    expect(res.headers.get('Cache-Control')).toBe('s-maxage=43200')
    await runWaitUntil(puts)
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) expect(key).toBeInstanceOf(Request)
    for (const key of keys) expect(new URL((key as Request).url).searchParams.get('v')).toBeTruthy()
  })

  it('serves the cached page on a repeat request without re-rendering', async () => {
    const cached = new Response('CACHED PAGE', { status: 200 })
    setCaches({ default: { match: async () => cached, put: async () => {} } })
    const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} }

    const res = await app.request('http://localhost/?feed=nyt', {}, { ENV: 'production' }, ctx)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('CACHED PAGE')
  })
})

describe('Static asset caching (/static/*)', () => {
  it('caches versioned assets immutably and unversioned ones briefly', async () => {
    const versioned = await app.request('http://localhost/static/js/main.js?v=abc')
    expect(versioned.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')

    const unversioned = await app.request('http://localhost/static/js/main.js')
    expect(unversioned.headers.get('Cache-Control')).toBe('public, max-age=300')
  })

  it('caches fonts immutably even though their @font-face URLs are unversioned', async () => {
    const font = await app.request('http://localhost/static/fonts/fraunces-latin-standard-normal.woff2')
    expect(font.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
  })
})

describe('Feed API caching (/api/feed)', () => {
  it('caches a 200 upstream response for an hour and serves repeats from cache', async () => {
    const cache = makeCache()
    setCaches({ default: cache, open: async () => cache })

    let fetchCount = 0
    globalThis.fetch = (async () => {
      fetchCount++
      return new Response(
        '<rss version="2.0"><channel><title>X</title><item><title>t</title><link>l</link></item></channel></rss>',
        { status: 200, headers: { 'content-type': 'application/rss+xml' } }
      )
    }) as unknown as typeof fetch

    const puts: Promise<unknown>[] = []
    const ctx = { waitUntil: (p: Promise<unknown>) => puts.push(p), passThroughOnException() {}, props: {} }
    const url = 'http://localhost/api/feed?feed=nyt'

    const first = await app.request(url, {}, { ENV: "production" }, ctx)
    expect(first.status).toBe(200)
    expect(first.headers.get('Cache-Control')).toContain('s-maxage=3600')
    expect(fetchCount).toBe(1)

    await runWaitUntil(puts)

    const second = await app.request(url, {}, { ENV: "production" }, ctx)
    expect(second.status).toBe(200)
    expect(fetchCount).toBe(1)
  })
})
