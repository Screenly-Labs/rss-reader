import { describe, expect, it } from 'bun:test'
import { sign } from '../sign'
import img from './img'

const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} }

const call = (url: string, env: Record<string, unknown>, headers?: Record<string, string>) =>
  img.fetch(new Request(url, headers ? { headers } : undefined), env, ctx)

describe('/img signed resize redirect', () => {
  it('404s when no signing key is configured', async () => {
    const res = await call('http://x/?u=https://e/a.jpg&s=abc', {})
    expect(res.status).toBe(404)
  })

  it('403s on a bad signature', async () => {
    const res = await call('http://x/?u=https://e/a.jpg&s=wrong', { IMAGE_SIGNING_KEY: 'k' })
    expect(res.status).toBe(403)
  })

  it('302-redirects a validly-signed URL to wsrv (webp, width-capped, ssl:)', async () => {
    const u = 'https://img.example/a.jpg'
    const s = await sign(u, 'k')
    const res = await call(`http://x/?u=${encodeURIComponent(u)}&s=${s}`, { IMAGE_SIGNING_KEY: 'k' }, {
      accept: 'image/avif,image/webp,*/*'
    })
    expect(res.status).toBe(302)
    const loc = res.headers.get('Location') ?? ''
    expect(loc).toContain('wsrv.nl')
    expect(loc).toContain('output=webp')
    expect(loc).toContain('w=2560')
    expect(loc).toContain('ssl%3Aimg.example')
  })

  it('falls back to jpg when the client does not accept webp', async () => {
    const u = 'https://img.example/a.jpg'
    const s = await sign(u, 'k')
    const res = await call(`http://x/?u=${encodeURIComponent(u)}&s=${s}`, { IMAGE_SIGNING_KEY: 'k' }, {
      accept: 'image/*,*/*'
    })
    expect(res.headers.get('Location') ?? '').toContain('output=jpg')
  })
})
