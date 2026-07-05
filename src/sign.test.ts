import { describe, expect, it } from 'bun:test'
import { sign, signedImagePath, verify } from './sign'

describe('sign / verify', () => {
  it('verifies a signature it produced', async () => {
    const sig = await sign('https://img.example/a.jpg', 'secret')
    expect(await verify('https://img.example/a.jpg', sig, 'secret')).toBe(true)
  })

  it('rejects a tampered value', async () => {
    const sig = await sign('https://img.example/a.jpg', 'secret')
    expect(await verify('https://img.example/evil.jpg', sig, 'secret')).toBe(false)
  })

  it('rejects a different key', async () => {
    const sig = await sign('https://img.example/a.jpg', 'secret')
    expect(await verify('https://img.example/a.jpg', sig, 'other-key')).toBe(false)
  })

  it('rejects a garbage signature', async () => {
    expect(await verify('https://img.example/a.jpg', 'not-a-sig', 'secret')).toBe(false)
  })

  it('builds a url-encoded /img path with a signature', async () => {
    const path = await signedImagePath('https://img.example/a.jpg?x=1&y=2', 'secret')
    expect(path).toMatch(
      /^\/img\?u=https%3A%2F%2Fimg\.example%2Fa\.jpg%3Fx%3D1%26y%3D2&s=[A-Za-z0-9_-]+$/
    )
  })
})
