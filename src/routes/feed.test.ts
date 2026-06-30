import { afterEach, describe, expect, it } from 'bun:test'
import feed from './feed'

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} }
const ORIGINAL_FETCH = globalThis.fetch

const xml = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'application/rss+xml' } })

const call = (path = 'http://localhost/', env: Record<string, string> = {}) =>
  feed.fetch(new Request(path), env, ctx)

const SAMPLE = `<rss version="2.0"><channel><title>Sample</title>
  <item>
    <title>Hello</title><link>https://e/1</link>
    <pubDate>Mon, 29 Jun 2026 10:00:00 GMT</pubDate>
    <description>Body</description>
  </item>
</channel></rss>`

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
})

describe('Feed route', () => {
  it('fetches and parses the selected feed', async () => {
    let captured = ''
    globalThis.fetch = (async (url: string | URL) => {
      captured = String(url)
      return xml(SAMPLE)
    }) as unknown as typeof fetch

    const res = await call('http://localhost/?feed=nyt')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.feed.id).toBe('nyt')
    expect(captured).toContain('nytimes.com')
    expect(body.items[0]).toMatchObject({ title: 'Hello', link: 'https://e/1' })
  })

  it('defaults to npr when no feed id is given', async () => {
    let captured = ''
    globalThis.fetch = (async (url: string | URL) => {
      captured = String(url)
      return xml(SAMPLE)
    }) as unknown as typeof fetch

    const res = await call('http://localhost/')

    expect(res.status).toBe(200)
    expect((await res.json()).feed.id).toBe('npr')
    expect(captured).toContain('npr.org')
  })

  it('returns 404 for an unknown feed id', async () => {
    globalThis.fetch = (async () => xml(SAMPLE)) as unknown as typeof fetch
    const res = await call('http://localhost/?feed=bogus')
    expect(res.status).toBe(404)
  })

  it('returns 502 when the upstream is not ok', async () => {
    globalThis.fetch = (async () => xml('nope', 500)) as unknown as typeof fetch
    const res = await call('http://localhost/?feed=nyt')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: true })
  })

  it('returns 502 (not a cacheable empty 200) when a 200 parses to no items', async () => {
    // Upstream served an HTML maintenance page with HTTP 200.
    globalThis.fetch = (async () =>
      new Response('<!doctype html><html><body>down for maintenance</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })) as unknown as typeof fetch
    const res = await call('http://localhost/?feed=nyt')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: true, reason: 'empty' })
  })

  it('returns 504 when the upstream times out', async () => {
    globalThis.fetch = ((_url: string, opts?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(xml(SAMPLE)), 200)
        opts?.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
      })) as unknown as typeof fetch

    const res = await call('http://localhost/?feed=nyt', { FEED_TIMEOUT_MS: '10' })
    expect(res.status).toBe(504)
  })

  it('returns 502 when fetch fails for other reasons', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const res = await call('http://localhost/?feed=nyt')
    expect(res.status).toBe(502)
  })
})
