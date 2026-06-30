import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { sign } from '../sign'
import img from './img'

const ORIGINAL_FETCH = globalThis.fetch
const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} }

const makeCache = () => {
  const store = new Map<string, Response>()
  const keyOf = (k: Request | string) => (typeof k === 'string' ? k : k.url)
  return {
    match: async (k: Request | string) => store.get(keyOf(k))?.clone(),
    put: async (k: Request | string, v: Response) => {
      store.set(keyOf(k), v.clone())
    }
  }
}

// Fake Images binding: ignores input, returns a fixed transformed response.
const fakeImages = {
  input() {
    return this
  },
  transform() {
    return this
  },
  async output() {
    return { response: () => new Response('TRANSFORMED', { headers: { 'content-type': 'image/avif' } }) }
  }
}

const call = (url: string, env: Record<string, unknown>, headers?: Record<string, string>) =>
  img.fetch(new Request(url, headers ? { headers } : undefined), env, ctx)

beforeEach(() => {
  ;(globalThis as unknown as { caches: unknown }).caches = { default: makeCache() }
})
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
})

describe('/img transform route', () => {
  it('404s when no signing key is configured', async () => {
    const res = await call('http://x/?u=https://e/a.jpg&s=abc', {})
    expect(res.status).toBe(404)
  })

  it('403s on a bad signature', async () => {
    const res = await call('http://x/?u=https://e/a.jpg&s=wrong', {
      IMAGE_SIGNING_KEY: 'k',
      IMAGES: fakeImages
    })
    expect(res.status).toBe(403)
  })

  it('transforms a validly-signed image', async () => {
    globalThis.fetch = (async () =>
      new Response('SRCBYTES', { status: 200, headers: { 'content-type': 'image/jpeg' } })) as unknown as typeof fetch
    const u = 'https://img.example/a.jpg'
    const s = await sign(u, 'k')
    const res = await call(`http://x/?u=${encodeURIComponent(u)}&s=${s}`, { IMAGE_SIGNING_KEY: 'k', IMAGES: fakeImages }, { accept: 'image/avif' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('TRANSFORMED')
  })

  it('falls back to the original image (302) when the upstream fails', async () => {
    globalThis.fetch = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch
    const u = 'https://img.example/a.jpg'
    const s = await sign(u, 'k')
    const res = await call(`http://x/?u=${encodeURIComponent(u)}&s=${s}`, { IMAGE_SIGNING_KEY: 'k', IMAGES: fakeImages })
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe(u)
  })
})
