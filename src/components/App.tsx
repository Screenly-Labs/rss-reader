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
        <article class='story' aria-live='polite'>
          <div class='story__media'>
            {/* Two layers cross-fade between items; the blurred copy fills any
                letterboxing for off-aspect images. */}
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

          <a
            class='story__brand'
            href='https://www.screenly.io'
            target='_blank'
            rel='noopener noreferrer'
            aria-label='Screenly — opens in a new tab'
          >
            <img src={`/static/images/screenly-logo.svg?v=${v}`} alt='Screenly' />
          </a>

          <div class='story__progress' id='story-progress' aria-hidden='true' />
        </article>

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
