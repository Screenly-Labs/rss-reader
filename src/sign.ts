// HMAC-SHA256 signing for the /img transform route. The same secret signs the
// image URLs the worker emits (in the feed JSON) and verifies them on the way
// into /img, so only URLs the worker minted are ever transformed — there is no
// open image proxy to enumerate or hotlink.

const encoder = new TextEncoder()

const importKey = (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign'
  ])

const toBase64Url = (buffer: ArrayBuffer): string => {
  let binary = ''
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const sign = async (value: string, secret: string): Promise<string> => {
  const key = await importKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return toBase64Url(signature)
}

// Length-safe, constant-time-ish comparison.
const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export const verify = async (value: string, signature: string, secret: string): Promise<boolean> =>
  safeEqual(await sign(value, secret), signature)

// The signed path the client requests; /img resizes + caches the source image.
export const signedImagePath = async (imageUrl: string, secret: string): Promise<string> =>
  `/img?u=${encodeURIComponent(imageUrl)}&s=${await sign(imageUrl, secret)}`
