// The query param that selects which curated feed to display, e.g. ?feed=npr.
// A short, known id (see feeds.ts) — not an arbitrary URL — so no encoding is
// needed and the worker only ever fetches feeds we vetted.
export const FEED_PARAM = 'feed'

// How many items the API returns (newest first) and the client rotates through.
export const MAX_ITEMS = 20

// Seconds each story is shown before the client advances to the next one.
export const ROTATE_SECONDS = 12

type DeployEnv = 'stage' | 'production'

// Analytics IDs per environment. This is a new app, so it ships without Sentry
// or Google Analytics wired up; fill these in (per env) to enable them. Empty
// values mean Layout renders no Sentry/GA script tags at all. When GA is
// enabled, main.ts tags every event with the feed `source` (see main.ts).
export const sentryIds: Record<DeployEnv, string> = {
  stage: '',
  production: ''
}

export const gaIds: Record<DeployEnv, string> = {
  stage: '',
  production: ''
}
