// Ambient declarations shared across the worker and client builds.

// The Cloudflare static-assets manifest is injected by the Workers runtime at
// build time; it has no real module on disk (tests stub it via mock.module).
declare module '__STATIC_CONTENT_MANIFEST' {
  const manifest: string
  export default manifest
}

// Worker environment bindings (wrangler.toml vars + secrets).
interface Env {
  // Deploy environment, used to select analytics IDs.
  ENV?: 'stage' | 'production'
  // Optional override for the upstream fetch timeout (ms), used in tests.
  FEED_TIMEOUT_MS?: string
  // HMAC secret for the signed /img resize route. When unset, images are served
  // as their originals (no resize, no signed-proxy surface).
  IMAGE_SIGNING_KEY?: string
}

// Google Analytics gtag, injected by the GA snippet when an ID is configured.
declare function gtag(...args: unknown[]): void
