// Ambient declarations shared across the worker and client builds.

// The Cloudflare static-assets manifest is injected by the Workers runtime at
// build time; it has no real module on disk (tests stub it via mock.module).
declare module '__STATIC_CONTENT_MANIFEST' {
  const manifest: string
  export default manifest
}

// Minimal shape of the Cloudflare Images binding we use (resize bytes we
// fetched). Kept local so it doesn't depend on @cloudflare/workers-types globals.
interface ImageTransformer {
  // Mirrors @cloudflare/workers-types ImageTransform: geometry/effects only.
  // NOTE: quality is NOT valid here — it lives on output() (ImageOutputOptions).
  transform(options: {
    width?: number
    height?: number
    fit?: 'scale-down' | 'contain' | 'cover' | 'crop' | 'pad' | 'squeeze'
  }): ImageTransformer
  output(options: { format: string; quality?: number }): Promise<{ response(): Response }>
}
interface ImagesBinding {
  input(stream: ReadableStream<Uint8Array>): ImageTransformer
}

// Worker environment bindings (wrangler.toml vars + secrets).
interface Env {
  // Deploy environment, used to select analytics IDs.
  ENV?: 'stage' | 'production'
  // Optional override for the upstream fetch timeout (ms), used in tests.
  FEED_TIMEOUT_MS?: string
  // HMAC secret for the signed /img transform route. When unset, images are
  // served as their originals (no transform, no public surface).
  IMAGE_SIGNING_KEY?: string
  // Cloudflare Images binding (per-Worker; no public endpoint).
  IMAGES?: ImagesBinding
}

// Google Analytics gtag, injected by the GA snippet when an ID is configured.
declare function gtag(...args: unknown[]): void
