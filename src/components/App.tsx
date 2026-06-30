import { ROTATE_SECONDS } from '../constants'
import { gaIds, sentryIds } from '../constants'
import Layout from './Layout'

interface AppProps {
  env?: 'stage' | 'production'
  feedId: string
  feedTitle: string
  v: string
}

// The SSR output is a static shell: empty slots that main.js fills from
// /api/feed, then rotates through. data-* on #feed-data is the only state the
// worker hands the client — the chosen feed and the rotation cadence. The shell
// starts in data-state="loading"; main.js flips it to "ready" (or "empty" /
// "error") once data arrives.
const App = ({ env, feedId, feedTitle, v }: AppProps) => {
  const sentryId = env ? sentryIds[env] : ''
  const gaId = env ? gaIds[env] : ''
  return (
    <Layout sentryId={sentryId} gaId={gaId} v={v}>
      <main id='stage' class='stage' data-state='loading' data-mode='media'>
        {/* Wire rail — shared masthead for both modes: RSS mark, source, a
            teletype position counter (NN/NN encodes the rotation sequence), the
            Screenly mark, and a transmission line that fills over each interval. */}
        <header class='rail'>
          <span class='rail__mark' aria-hidden='true' />
          <span class='rail__source' id='rail-source'>
            {feedTitle}
          </span>
          <span class='rail__pos' id='rail-pos' aria-hidden='true' />
          <a
            class='rail__brand'
            href='https://www.screenly.io'
            target='_blank'
            rel='noopener noreferrer'
            aria-label='Screenly — opens in a new tab'
          >
            <img src={`/static/images/screenly-logo.svg?v=${v}`} alt='Screenly' />
          </a>
          <span class='rail__line' aria-hidden='true'>
            <span class='rail__fill' id='rail-fill' />
          </span>
        </header>

        <article class='story' aria-live='polite'>
          <div class='story__media'>
            {/* Contained image over a blurred copy that fills any letterboxing. */}
            <div class='story__img story__img--back' id='story-img-back' aria-hidden='true' />
            <div class='story__img' id='story-img' aria-hidden='true' />
          </div>
          <div class='story__scrim' aria-hidden='true' />

          <div class='story__panel' id='story-panel'>
            <p class='story__kicker'>
              <span class='story__source' id='story-source'>
                {feedTitle}
              </span>
              <span class='story__time' id='story-time' />
            </p>
            {/* Placeholder content (hidden while loading) keeps the heading
                accessible; main.ts replaces it with the story headline. */}
            <h1 class='story__title' id='story-title'>
              {feedTitle}
            </h1>
            <p class='story__summary' id='story-summary' />
          </div>

          {/* QR to the article, bracketed like a wire stamp. main.ts fills
              #story-qr-code per item; hidden when the item has no link. */}
          <div class='qr' id='story-qr' hidden>
            <div class='qr__frame'>
              <div class='qr__code' id='story-qr-code' />
            </div>
            <span class='qr__label'>Scan ↗ read more</span>
          </div>
        </article>

        {/* Multi-item view for text-heavy feeds: main.ts fills it with as many
            stories as fit (each with its own QR) and paginates. */}
        <section class='list' aria-live='polite'>
          <ul class='list__items' id='list-items' />
        </section>

        <p class='status' id='status'>
          Loading {feedTitle}…
        </p>
      </main>

      <span
        id='feed-data'
        data-feed-id={feedId}
        data-feed-title={feedTitle}
        data-rotate-seconds={String(ROTATE_SECONDS)}
      />
    </Layout>
  )
}

export default App
