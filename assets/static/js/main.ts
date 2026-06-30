import { largestFit, relativeTime } from './render'
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
  feed?: { id: string; title: string; category: string }
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

  let items: FeedItem[] = []
  let index = 0
  // True once the first feed has rendered, so hourly background refreshes swap
  // the item list in place without yanking the carousel back to story 1.
  let loaded = false
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
  const progressEl = byId('story-progress')
  const statusEl = byId('status')

  const prefersReducedMotion = (): boolean =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false

  const track = (name: string, payload: Record<string, unknown>): void => {
    // Every event carries the feed `source` so analytics can break usage down
    // by which feed a screen is showing.
    if (typeof gtag !== 'undefined') {
      gtag('event', name, { app_name: APP_NAME, source: feedId, source_title: feedTitle, ...payload })
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

  // Build the progress dots once per feed load (capped so 60-item feeds don't
  // produce a hairline of dots).
  const buildProgress = (count: number): void => {
    if (!progressEl) return
    const dots = Math.min(count, 12)
    const frag = document.createDocumentFragment()
    for (let i = 0; i < dots; i++) {
      const dot = document.createElement('span')
      dot.className = 'dot'
      frag.appendChild(dot)
    }
    progressEl.replaceChildren(frag)
  }

  const updateProgress = (active: number): void => {
    if (!progressEl) return
    const dots = progressEl.children
    // With more items than dots, map the item index onto the dot range.
    const activeDot = dots.length > 0 ? active % dots.length : 0
    for (let i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('is-active', i === activeDot)
    }
  }

  // The fit-to-canvas pass. The panel is a fixed box (CSS height + overflow
  // hidden); we (1) shrink the title only if it alone overflows, then (2) keep
  // the most summary words that still fit. Result: the headline is always
  // shown, plus as much body as the screen allows — never clipped, never just
  // the headline when there is room for more.
  const fitPanel = (summary: string): void => {
    if (!panel || !titleEl || !summaryEl || !stage) return

    const overflows = (): boolean => panel.scrollHeight > panel.clientHeight + 1
    const words = summary ? summary.split(/\s+/).filter(Boolean) : []

    const setTitleScale = (scale: number): void => stage.style.setProperty('--title-scale', String(scale))
    const setWords = (n: number): void => {
      if (n <= 0) {
        // No room for any body (huge headline on a tiny panel): show none rather
        // than a stray lone ellipsis.
        summaryEl.textContent = ''
      } else if (n >= words.length) {
        summaryEl.textContent = summary
      } else {
        summaryEl.textContent = `${words.slice(0, n).join(' ')}…`
      }
    }

    // Reset, then measure with no summary so the title is fit on its own first.
    setTitleScale(1)
    summaryEl.textContent = ''
    let scale = 1
    while (scale > TITLE_SCALE_FLOOR && overflows()) {
      scale = Math.max(TITLE_SCALE_FLOOR, scale - TITLE_SCALE_STEP)
      setTitleScale(scale)
    }

    // Now fill the remaining space with as many summary words as fit.
    const best = largestFit(words.length, (n) => {
      setWords(n)
      return !overflows()
    })
    setWords(best)
  }

  const preloadNext = (): void => {
    if (items.length < 2) return
    const next = items[(index + 1) % items.length]
    if (next?.image) {
      const img = new Image()
      img.src = next.image
    }
  }

  const show = (i: number): void => {
    const item = items[i]
    if (!item || !stage) return

    stage.dataset.mode = item.image ? 'media' : 'text'
    setBackground(imgEl, item.image)
    setBackground(imgBackEl, item.image)

    if (sourceEl) sourceEl.textContent = feedTitle
    if (timeEl) timeEl.textContent = relativeTime(item.publishedAt, Date.now())
    if (titleEl) titleEl.textContent = item.title

    // Retrigger the entrance animation for this item (unless reduced motion).
    stage.classList.remove('is-in')
    if (!prefersReducedMotion()) {
      // Force reflow so removing + re-adding the class restarts the animation.
      stage.getBoundingClientRect()
      stage.classList.add('is-in')
    }

    // Fit after the new text/layout is in the DOM. Re-fit once webfonts settle,
    // since glyph metrics change wrapping.
    requestAnimationFrame(() => fitPanel(item.summary))
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => fitPanel(item.summary)).catch(() => {})
    }

    updateProgress(i)
    preloadNext()
  }

  const scheduleRotate = (): void => {
    clearTimeout(rotateTimer)
    if (items.length < 2) return
    rotateTimer = setTimeout(() => {
      index = (index + 1) % items.length
      show(index)
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
    if (data.title) feedTitle = data.title
    if (index >= items.length) index = 0
    buildProgress(items.length)
    setState('ready')
    if (!loaded) {
      loaded = true
      index = 0
      show(0)
      scheduleRotate()
    } else {
      // Background refresh: keep showing the current story; the running rotation
      // timer picks up the new list on its next tick.
      updateProgress(index)
    }
    track('feed_loaded', { items: items.length })
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
  }

  const init = (): void => {
    readConfig()
    fetchFeed()
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        const item = items[index]
        if (item) fitPanel(item.summary)
      }, 150)
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
