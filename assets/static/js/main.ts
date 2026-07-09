import qrcode from 'qrcode-generator'
import { hostLabel, largestFit, relativeTime } from './render'
// The wire contract is defined once in the worker's parser. `import type` is
// erased at build, so this pulls in no worker runtime code.
import type { FeedItem } from '../../../src/parse'

// This file is the build ENTRY. build.ts bundles it (inlining ./render) into
// the served assets/static/js/main.js, loaded as a PLAIN classic <script>. It
// must stay a self-executing IIFE with NO top-level `export`: the testable
// helpers live in ./render (bundled in here), and this file exports nothing —
// so the served bundle is loadable by every cached HTML variant and a deploy
// never strands a cached page.

interface FeedResponse {
  feed?: { id: string; title: string; category: string; variant?: string }
  title?: string
  items?: FeedItem[]
  error?: boolean
}

;(() => {
  const APP_NAME = 'Screenly RSS Reader'
  // Re-fetch on the same cadence as the edge cache so new items appear without
  // hammering the worker. Keep in sync with FEED_CACHE_TTL_SECONDS (constants.ts).
  const REFRESH_MS = 60 * 60 * 1000
  // Title may shrink to this fraction of its base size before we stop (it never
  // gets unreadably small; the summary absorbs the rest by trimming).
  const TITLE_SCALE_FLOOR = 0.62
  const TITLE_SCALE_STEP = 0.06
  // Feeds with at least this fraction of items carrying an image get the big
  // one-photo-at-a-time story; text-heavier feeds get the multi-item list, which
  // packs several short stories per page.
  const IMAGE_FEED_THRESHOLD = 0.4

  let items: FeedItem[] = []
  // In story mode: the current item index. In list mode: the start index of the
  // NEXT page to show.
  let pos = 0
  let listPageStart = 0
  let listSinglePage = false
  let mode: 'story' | 'list' = 'story'
  let loaded = false
  let imgToken = 0
  let feedId = ''
  let feedTitle = ''
  let rotateMs = 12000
  let rotateTimer: ReturnType<typeof setTimeout>
  let refreshTimer: ReturnType<typeof setTimeout>
  let resizeTimer: ReturnType<typeof setTimeout>

  const byId = (id: string): HTMLElement | null => document.getElementById(id)

  const stage = byId('stage')
  const panel = byId('story-panel')
  const titleEl = byId('story-title')
  const summaryEl = byId('story-summary')
  const sourceEl = byId('story-source')
  const timeEl = byId('story-time')
  const imgEl = byId('story-img')
  const imgBackEl = byId('story-img-back')
  const qrEl = byId('story-qr')
  const qrCodeEl = byId('story-qr-code')
  const listItemsEl = byId('list-items')
  const railSourceEl = byId('rail-source')
  const railPosEl = byId('rail-pos')
  const statusEl = byId('status')

  const prefersReducedMotion = (): boolean =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false

  const track = (name: string, payload: Record<string, unknown>): void => {
    // Every event carries the feed `source` so analytics can break usage down
    // by which feed a screen is showing.
    if (typeof gtag !== 'undefined') {
      gtag('event', name, {
        app_name: APP_NAME,
        source: feedId,
        source_title: feedTitle,
        ...payload
      })
    }
  }

  const setState = (state: 'loading' | 'ready' | 'empty' | 'error'): void => {
    if (stage) stage.dataset.state = state
  }

  const setBackground = (el: HTMLElement | null, url: string | null): void => {
    if (!el) return
    // Wrap in quotes and neutralize any embedded quote so a feed URL can't break
    // out of the url() value.
    el.style.backgroundImage = url ? `url("${url.replace(/"/g, '%22')}")` : ''
  }

  // Restart the per-page entrance animation (unless reduced motion).
  const animateIn = (): void => {
    if (!stage) return
    stage.classList.remove('is-in')
    if (!prefersReducedMotion()) {
      stage.getBoundingClientRect() // force reflow so re-adding restarts it
      stage.classList.add('is-in')
    }
  }

  // Generate a QR SVG for a link. The SVG is built locally (modules only — the
  // URL is encoded, never injected as markup).
  const makeQrSvg = (link: string): string => {
    const qr = qrcode(0, 'M')
    qr.addData(link)
    qr.make()
    return qr.createSvgTag({ scalable: true, margin: 0 })
  }

  const pad = (n: number): string => String(n).padStart(2, '0')

  // ---- Story mode (one photo story at a time) -------------------------------

  // The fit-to-canvas pass. The panel is a fixed box (CSS height + overflow
  // hidden); we (1) shrink the title only if it alone overflows, then (2) keep
  // the most summary words that still fit. The headline is always shown, plus as
  // much body as the screen allows — never clipped, never just the headline.
  const fitPanel = (summary: string): void => {
    if (!panel || !titleEl || !summaryEl || !stage) return

    const overflows = (): boolean => panel.scrollHeight > panel.clientHeight + 1
    const words = summary ? summary.split(/\s+/).filter(Boolean) : []

    const setTitleScale = (scale: number): void =>
      stage.style.setProperty('--title-scale', String(scale))
    const setWords = (n: number): void => {
      if (n <= 0) {
        summaryEl.textContent = ''
      } else if (n >= words.length) {
        summaryEl.textContent = summary
      } else {
        summaryEl.textContent = `${words.slice(0, n).join(' ')}…`
      }
    }

    setTitleScale(1)
    summaryEl.textContent = ''
    let scale = 1
    while (scale > TITLE_SCALE_FLOOR && overflows()) {
      scale = Math.max(TITLE_SCALE_FLOOR, scale - TITLE_SCALE_STEP)
      setTitleScale(scale)
    }

    const best = largestFit(words.length, (n) => {
      setWords(n)
      return !overflows()
    })
    setWords(best)
  }

  // Render a QR to the article link so a viewer can scan to read more. The SVG
  // is generated locally (modules only — the URL is encoded, never injected as
  // markup) and sits on a white tile for reliable scanning on the dark theme.
  const setQr = (link: string): void => {
    if (!qrEl || !qrCodeEl) return
    if (!link) {
      qrEl.hidden = true
      qrCodeEl.replaceChildren()
      return
    }
    qrCodeEl.innerHTML = makeQrSvg(link)
    qrEl.hidden = false
  }

  const preloadNext = (): void => {
    if (items.length < 2) return
    const next = items[(pos + 1) % items.length]
    if (next?.image) {
      const img = new Image()
      img.src = next.image
    }
  }

  const showStory = (i: number): void => {
    const item = items[i]
    if (!item || !stage) return

    stage.dataset.mode = item.image ? 'media' : 'text'
    // Load-gate the image: keep the previous frame until the new one has
    // decoded, so a slow/large source never paints a half-loaded or blank
    // image. The token guards against the carousel advancing mid-load.
    const token = ++imgToken
    if (item.image) {
      const pre = new Image()
      pre.src = item.image
      const apply = (): void => {
        if (token !== imgToken) return // a newer slide superseded this one
        setBackground(imgEl, item.image)
        setBackground(imgBackEl, item.image)
      }
      const ready = pre.decode ? pre.decode() : Promise.reject()
      ready.then(apply).catch(() => {
        // decode() can reject on some hosts even when the image loads; fall back
        // to load/error events, still token-guarded.
        pre.onload = apply
        pre.onerror = apply
        if (pre.complete) apply()
      })
    } else {
      setBackground(imgEl, null)
      setBackground(imgBackEl, null)
    }

    // The eyebrow shows the article's own domain (distinct from the rail's
    // curated feed name); fall back to the feed title if the link won't parse.
    if (sourceEl) sourceEl.textContent = hostLabel(item.link) || feedTitle
    if (timeEl) timeEl.textContent = relativeTime(item.publishedAt, Date.now())
    if (titleEl) titleEl.textContent = item.title
    setQr(item.link)
    if (railPosEl) railPosEl.textContent = `${pad(i + 1)} / ${pad(items.length)}`

    animateIn()

    // Fit after the new text is in the DOM; re-fit once webfonts settle, since
    // glyph metrics change wrapping.
    requestAnimationFrame(() => fitPanel(item.summary))
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => fitPanel(item.summary)).catch(() => {})
    }

    preloadNext()
  }

  // ---- List mode (several short stories per page) ---------------------------

  const buildListItem = (item: FeedItem, now: number): HTMLLIElement => {
    const li = document.createElement('li')
    li.className = 'list__item'

    const body = document.createElement('div')
    body.className = 'list__body'

    const title = document.createElement('h2')
    title.className = 'list__title'
    title.textContent = item.title
    body.appendChild(title)

    if (item.summary) {
      const sum = document.createElement('p')
      sum.className = 'list__sum'
      sum.textContent = item.summary
      body.appendChild(sum)
    }

    const when = relativeTime(item.publishedAt, now)
    if (when) {
      const time = document.createElement('span')
      time.className = 'list__time'
      time.textContent = when
      body.appendChild(time)
    }
    li.appendChild(body)

    // Each row carries its own QR so any story in the list is scannable.
    if (item.link) {
      const qr = document.createElement('div')
      qr.className = 'list__qr'
      qr.innerHTML = makeQrSvg(item.link)
      li.appendChild(qr)
    }
    return li
  }

  // Fill the list with items from `start`, then drop from the end until the page
  // fits the fixed canvas. Returns how many items were shown.
  const renderListPage = (start: number): number => {
    if (!listItemsEl) return 0
    const now = Date.now()
    const frag = document.createDocumentFragment()
    for (let i = start; i < items.length; i++) frag.appendChild(buildListItem(items[i], now))
    listItemsEl.replaceChildren(frag)

    while (
      listItemsEl.scrollHeight > listItemsEl.clientHeight + 1 &&
      listItemsEl.children.length > 1
    ) {
      const last = listItemsEl.lastElementChild
      if (!last) break
      listItemsEl.removeChild(last)
    }
    return listItemsEl.children.length
  }

  const showListPage = (): void => {
    if (!stage) return
    stage.dataset.mode = 'list'
    if (pos >= items.length) pos = 0
    const start = pos
    const count = renderListPage(start)
    listPageStart = start
    listSinglePage = count >= items.length
    pos = listSinglePage ? 0 : (start + count) % items.length
    animateIn()
  }

  // ---- Shared rotation ------------------------------------------------------

  const scheduleRotate = (): void => {
    clearTimeout(rotateTimer)
    if (items.length < 2) return
    if (mode === 'list' && listSinglePage) return // everything fits on one page
    rotateTimer = setTimeout(() => {
      if (mode === 'list') {
        showListPage()
      } else {
        pos = (pos + 1) % items.length
        showStory(pos)
      }
      scheduleRotate()
    }, rotateMs)
  }

  const render = (data: FeedResponse): void => {
    if (data.error || !Array.isArray(data.items) || data.items.length === 0) {
      setState(data.error ? 'error' : 'empty')
      if (statusEl) {
        statusEl.textContent = data.error
          ? `Couldn’t load ${feedTitle}.`
          : `No stories in ${feedTitle} right now.`
      }
      track('feed_empty', { error: Boolean(data.error) })
      return
    }

    items = data.items
    // Use the curated registry title for the source label — the feed's own
    // <title> is sometimes ugly (Google News "site:reuters.com when:1d ...",
    // CBS "Home - cbsnews.com"). SSR already seeded feedTitle from the registry.
    if (data.feed?.title) feedTitle = data.feed.title
    // Bespoke feeds (e.g. 'comic') get their own CSS treatment via the stage.
    if (stage) stage.dataset.variant = data.feed?.variant ?? ''

    const imaged = items.filter((item) => item.image).length
    mode = imaged / items.length >= IMAGE_FEED_THRESHOLD ? 'story' : 'list'

    if (railSourceEl) railSourceEl.textContent = feedTitle
    setState('ready')

    if (mode === 'list') {
      if (railPosEl) railPosEl.textContent = `${items.length} stories`
      // On a background refresh, re-render the page we're currently showing so
      // the screen doesn't jump; otherwise start at the top.
      if (loaded) {
        renderListPage(Math.min(listPageStart, items.length - 1))
      } else {
        loaded = true
        pos = 0
        showListPage()
        scheduleRotate()
      }
    } else {
      if (pos >= items.length) pos = 0
      if (loaded) {
        // Keep showing the current story; the running timer picks up the new list.
        if (railPosEl) railPosEl.textContent = `${pad(pos + 1)} / ${pad(items.length)}`
      } else {
        loaded = true
        pos = 0
        showStory(0)
        scheduleRotate()
      }
    }

    track('feed_loaded', { items: items.length, mode })
  }

  const refit = (): void => {
    if (mode === 'list') {
      renderListPage(Math.min(listPageStart, Math.max(0, items.length - 1)))
    } else {
      const item = items[pos]
      if (item) fitPanel(item.summary)
    }
  }

  const fetchFeed = async (): Promise<void> => {
    clearTimeout(refreshTimer)
    try {
      const response = await fetch(`/api/feed?feed=${encodeURIComponent(feedId)}`)
      const cached = response.headers.get('cf-cache-status') === 'HIT'
      const data = (await response.json()) as FeedResponse
      render(data)
      track('cache_status', { cached })
    } catch (e) {
      console.log(e)
      // Keep showing whatever is already on screen; only flag error on a cold
      // start with nothing to display.
      if (items.length === 0) {
        setState('error')
        if (statusEl) statusEl.textContent = `Couldn’t load ${feedTitle}.`
      }
    }
    refreshTimer = setTimeout(fetchFeed, REFRESH_MS)
  }

  const readConfig = (): void => {
    const data = byId('feed-data')
    feedId = data?.dataset.feedId ?? ''
    feedTitle = data?.dataset.feedTitle ?? ''
    const seconds = Number(data?.dataset.rotateSeconds)
    if (Number.isFinite(seconds) && seconds > 0) rotateMs = seconds * 1000
    // Drives the transmission line's fill duration (CSS animation).
    stage?.style.setProperty('--rotate-ms', `${rotateMs}ms`)
  }

  // On a Screenly player the viewer is already a Screenly customer, so the
  // promotional Screenly badge is removed. The 'screenly-viewer' token in the
  // user agent marks these devices; every other browser keeps the badge.
  const removeScreenlyBranding = (): void => {
    if (navigator.userAgent.includes('screenly-viewer')) {
      document.querySelector('.brand')?.remove()
    }
  }

  const init = (): void => {
    removeScreenlyBranding()
    readConfig()
    fetchFeed()
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(refit, 150)
    })
  }

  // Only auto-run in a real browser; under the test runner there is no document.
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init)
    } else {
      init()
    }
  }
})()
