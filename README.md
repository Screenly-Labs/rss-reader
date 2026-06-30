# Screenly RSS Reader

A full-screen, auto-rotating **RSS / Atom / Media-RSS reader** for digital
signage, served from a Cloudflare Worker. It shows one story at a time — image,
source, time, headline, and as much body as the screen fits — cycling through a
curated set of feeds you pick from the app store.

## How it works

- Pick a feed in the app store; the screen URL becomes `…/?feed=<id>`.
- The Worker fetches that feed **server-side** (so there are no browser CORS
  problems), parses RSS / Atom / Media RSS into a common shape, and **caches it
  at the edge for 1 hour**.
- The page rotates through the latest items, re-fetching every hour. The layout
  fits any screen from an 800×480 Raspberry Pi panel to 4K, in both
  orientations, scaling the headline and trimming the body so nothing overflows.

## Feeds

Curated, vetted public feeds (edit `src/feeds.ts`):

| Category   | Feeds |
| ---------- | ----- |
| General    | NPR, CBS News, The New York Times, Fox News, ABC News, Reuters (US), BBC World |
| Tech       | Hacker News, The Verge, Ars Technica |
| Visual     | NASA Image of the Day, PetaPixel |
| Long-form  | Longreads |

Pass `?feed=<id>` (e.g. `?feed=nyt`). An unknown or missing id falls back to NPR.

## Develop

Bun only — no npm/npx.

```bash
bun install      # install deps + vendor fonts
bun run dev      # wrangler dev on http://localhost:8888  (try /?feed=nyt)
bun test         # parser, client helpers, worker routes
bun run lint     # Biome
bun run build    # bundle/minify client assets
```

## Deploy

- Push to `master` → deploys to the **stage** environment.
- Push to `production` → deploys to **production**.

Both run on Cloudflare via `wrangler-action`; set `CF_API_TOKEN` and
`CF_ACCOUNT_ID` as repository secrets. No upstream API key is needed — every
feed is public.

See [CLAUDE.md](./CLAUDE.md) for architecture and conventions.

## License

AGPL-3.0-only.
