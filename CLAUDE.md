# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A full-screen, auto-rotating **RSS / Atom / Media-RSS reader** for Screenly
digital signage, deployed as a **Cloudflare Worker** (Hono JSX SSR at the edge).
It follows the same Cloudflare Worker + Hono JSX (TypeScript) pattern used across
our other signage apps.

The screen shows one story at a time (a contained image over a blurred fill,
the source, relative time, the headline, and **as much body text as fits**),
advancing every few seconds.

### Why a Worker and not a static site

An earlier idea was a static GitHub Pages app taking an arbitrary feed URL via a
base64 query param. That fails in the browser: most feeds send no CORS headers,
so a client-side `fetch` is blocked. Instead the Worker fetches a **curated set
of feeds server-side** (no CORS), parses them, and **edge-caches each for 1 hour**.
Config is just which feed to show (a short, known `id`, not a URL), so no
encoding is needed and the Worker only ever fetches feeds we vetted.

## Architecture

### Request flow (`src/index.tsx`)

1. `GET /` reads `?feed=<id>`. A missing or unknown id 301-redirects to the
   default feed (`feeds.ts` → `DEFAULT_FEED_ID`), so the render path always has
   a known feed.
2. The HTML shell is server-rendered (`components/App.tsx`) and stored in the
   edge page cache (`caches.default`, `s-maxage=43200` / 12h). The key is
   versioned by `ASSET_VERSION` (a hash of the static-asset manifest) so a deploy
   busts it; the feed id is in the URL, so feeds cache independently.
3. `GET /api/feed?feed=<id>` (`src/routes/feed.ts`) fetches the feed upstream
   (10s `AbortController` timeout → 504; other upstream failures → 502), parses
   it, and returns normalized JSON. Wrapped in Hono's `cache()` middleware at
   **`s-maxage=3600` (1 hour)**, the per-source cache requirement.
4. `assets/static/js/main.js` reads the feed id from `#feed-data`, fetches
   `/api/feed`, and rotates through the items, re-fetching hourly.

### The parser (`src/parse.ts`): no DOMParser in Workers

The Workers runtime has no `DOMParser`, so feeds are parsed by a small,
dependency-free, namespace-aware XML tokenizer (CDATA, comments, entities,
quoted attributes, `media:*` / `content:encoded`). `parseFeed` normalizes
RSS 2.0, RSS 1.0 (RDF), and Atom into one `FeedItem` shape:
`{ title, link, publishedAt, summary, image, media }`.

**Image resolution is a fallback chain**: many real feeds carry no `media:*`
tag and bury the image in HTML: `media:content` (image, widest) →
`media:thumbnail` → image `<enclosure>` → `itunes:image` → first `<img>` in
`content:encoded`/`description` (or serialized Atom `type="xhtml"` content).
`media` also detects audio/video enclosures (podcasts, video). Text is stored
raw and decoded exactly once at consumption; relative item/image URLs are
resolved against the feed's own URL (`baseUrl`).

**Known limitation:** tags are matched by hardcoded lowercased prefix
(`media:content`, `dc:date`, `content:encoded`), not by resolving the declared
namespace URI. A feed that binds the Media-RSS / Dublin Core namespace to a
non-standard prefix would miss its image/date. Every curated feed uses the
conventional prefixes; revisit if a future feed doesn't.

### Image pipeline (resize via signed redirect)

Feeds ship multi-MB originals (NASA up to 100+ MB), which never finish loading
before a signage slide rotates, so images are width-capped/recompressed. The
resize runs on **wsrv.nl** (images.weserv.nl), reached by a **signed 302
redirect** from our own `/img` route.

- `src/routes/feed.ts` rewrites each item image to `/img?u=<src>&s=<hmac>`
  (`src/sign.ts`, HMAC-SHA256 of the source URL), only when `IMAGE_SIGNING_KEY`
  is set; otherwise originals are served (safe default).
- `src/routes/img.ts` verifies the signature, then **302-redirects the browser**
  to `https://wsrv.nl/?url=ssl:<src>&w=2560&we&q=80&output=webp|jpg` (format from
  the client `Accept`; wsrv has no AVIF). wsrv resizes + CDN-caches. Only signed
  URLs are honored, so it isn't an open redirector.
- `assets/static/js/main.ts` **load-gates** each slide: it preloads the image and
  only swaps the background once `img.decode()` resolves (token-guarded against
  the carousel advancing), so a slow/large source never paints a blank/half frame.

**Why not the in-Worker path:** the Cloudflare Images binding (`env.IMAGES`) is
the obvious choice but isn't available in our setup. Proxying wsrv through the
Worker doesn't work either, because wsrv **403s Cloudflare Worker subrequests**, so we
redirect the browser instead. Do NOT use the public `/cdn-cgi/image/` zone
endpoint (unauthenticated billable transforms / open proxy).

**Ops:** set the secret per env (`openssl rand -hex 32 | wrangler secret put
IMAGE_SIGNING_KEY --env stage`); local key in `.dev.vars` (gitignored). No
Cloudflare Images subscription needed. Edge case: sources beyond wsrv's input
limit (~100 MB) come back broken for that one slide; everything sane is capped.

### Fit-to-canvas (the hard part): `assets/static/js/main.ts`

Signage has a **fixed canvas** (480p → 4K, both orientations) but feed content
varies wildly. We must show the headline **and** body without overflow or
clipping. The text band (`.story__panel`) is a capped, `overflow:hidden` box;
after each item renders, `fitPanel()`:

1. shrinks the headline only if it alone overflows (down to a readable floor), then
2. uses `largestFit` (binary search in `render.ts`) to keep the most summary
   words that still fit the remaining space.

Result: the headline is always shown, plus as much body as the screen allows:
a line or two on an 800×480 Pi, a full paragraph on 4K. It re-fits on resize and
once webfonts settle.

### The feed registry (`src/feeds.ts`)

The single source of truth: `{ id, title, url, category }`. Ids are the public
config contract (keep them short/stable). To add a feed: append an entry,
confirm it parses, done. Categories: `general` (US-centric news), `tech`,
`visual` (Media-RSS imagery), `longform` (slow journalism).

## Commands (Bun only, no npm/npx)

```bash
bun install            # deps; vendored fonts come from @fontsource via sync-fonts
bun run dev            # build client JS, then wrangler dev on :8888
bun run build          # vendor fonts, bundle+minify client JS (in place), minify CSS
bun test               # bun:test: parser, client helpers, worker routes
bun run typecheck      # tsc --noEmit (strict)
bun run lint           # biome lint --error-on-warnings (matches CI)
bun run format         # biome format --write
```

Deploy: push `master` → stage, push `production` → prod (wrangler-action; needs
`CF_API_TOKEN` + `CF_ACCOUNT_ID` repo secrets). No upstream API key. Feeds are
public.

## Conventions (match the Worker app family)

- **Biome**: single quotes, no semicolons, no trailing commas, 2-space, 100 cols.
- Hono JSX via `hono/jsx` (`jsxImportSource`). `Layout` is an `hono/html`
  template; `App` is JSX.
- `assets/static/js/main.ts` MUST stay an export-free self-executing script;
  testable helpers live in `render.ts` and are inlined by `build.ts`
  (`Bun.build({ external: [] })`). The served bundle `main.js` is gitignored.
- `build.ts` minifies CSS **in place**, don't commit minified CSS.
- Tests stub the Cloudflare-only `__STATIC_CONTENT_MANIFEST` and
  `hono/cloudflare-workers`, and stub the Cache API (see `src/index.test.ts`).
- Analytics: GA4 is on in **production only** (`gaIds.production` in
  `constants.ts`; `stage` is empty so stage traffic never pollutes the property).
  The feed rides along on the GA4 automatic `page_view` (the `source` /
  `source_title` passed to the `gtag('config', …)` call in `Layout.tsx`), and
  `main.ts` tags **every later event with the same feed `source`** (id + title),
  so both visits and interactions break down by feed. Since the feed lives in the
  `?feed=` query string, GA's default *Page path* strips it — the explicit
  `source` param is what makes feed a first-class dimension. **GA-side setup:**
  register `source` and `source_title` as event-scoped **custom dimensions**
  (GA4 → Admin → Custom definitions) or they're collected but not selectable in
  reports.

## Supported resolutions

Full responsiveness via one fluid `clamp(vw+vh)` root size + the JS fitter; at
minimum it must look correct at 4K / 1080p / 720p / 800×480, in **both
orientations**.

## Deferred / follow-ups

- The app-store integration (a config dropdown of the feed ids), lives outside
  this repo, not wired up yet.
