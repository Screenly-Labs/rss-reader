// The self-describing signage-app manifest. Served verbatim (as JSON) from
// /.well-known/signage-app.json so the Screenly app store can render this app's
// config page and signage players can consume its settings directly, instead of
// anyone re-implementing the settings form by hand. See the spec in the sibling
// `Screenly-Labs/app-store` repo (`docs/app-manifest.md`) and validate against
// its `static/schemas/signage-app-manifest.schema.json`.
//
// This is a STEPPED app: it self-advances through one story at a time and loops
// forever. The dwell per step (ROTATE_SECONDS) and the item count (MAX_ITEMS)
// are fixed product constants, not user settings, so they live in `playback`
// (stepSeconds) rather than in the settings form. refreshIntervalS mirrors the
// per-feed edge cache TTL (FEED_CACHE_TTL_SECONDS) and the client's own refresh.
//
// The ONLY user setting is which curated feed to show. Its enum, labels and
// default are derived directly from src/feeds.ts (the single source of truth for
// the feed registry) so the config dropdown can never drift from the ids the
// worker actually accepts. The launch template explodes that one setting into
// `?feed=<id>`, the exact param the worker resolves on the `/` route.
import { FEED_CACHE_TTL_SECONDS, FEED_PARAM, ROTATE_SECONDS } from './constants'
import { DEFAULT_FEED_ID, FEEDS } from './feeds'

export const manifest = {
  manifestVersion: '1',
  id: 'rss',
  name: 'RSS Reader',
  description:
    'A full-screen, auto-rotating reader for a curated set of RSS, Atom and Media-RSS feeds. Shows one story at a time — its image, source, relative time, headline and as much body text as the screen fits — advancing every few seconds and refreshing hourly on any display.',
  summary: 'Auto-rotating headlines from curated feeds for any display.',
  vendor: 'Screenly',
  tags: ['News', 'RSS'],
  homepage: 'https://rss.srly.io/',
  source: 'https://github.com/Screenly-Labs/rss-reader',
  support: 'https://github.com/Screenly-Labs/rss-reader/issues',
  // Stepped: the client cycles through the feed's items forever, dwelling
  // ROTATE_SECONDS on each, and re-fetches the parsed feed every
  // FEED_CACHE_TTL_SECONDS (matched to the edge cache TTL). Neither the dwell
  // nor the item count is user-configurable, so they belong here, not in settings.
  playback: {
    pacing: 'stepped',
    loops: true,
    stepSeconds: ROTATE_SECONDS,
    refreshIntervalS: FEED_CACHE_TTL_SECONDS
  },
  // One setting: the curated feed id. enum / x-enumLabels / default are generated
  // from src/feeds.ts, so adding or renaming a feed there updates this manifest
  // automatically (index.test.ts asserts they stay in lockstep).
  settings: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      [FEED_PARAM]: {
        type: 'string',
        title: 'Feed',
        'x-widget': 'select',
        enum: FEEDS.map((feed) => feed.id),
        'x-enumLabels': FEEDS.map((feed) => feed.title),
        default: DEFAULT_FEED_ID
      }
    }
  },
  // The one setting explodes into `?feed=<id>`, the exact param the worker
  // resolves in src/index.tsx.
  launch: {
    baseUrl: 'https://rss.srly.io/',
    template: `{?${FEED_PARAM}}`
  }
} as const
