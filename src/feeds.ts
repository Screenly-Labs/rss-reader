// The curated feed registry. Each entry is a vetted public RSS/Atom/Media-RSS
// source the worker is allowed to fetch server-side. The app-store config UI
// (a separate follow-up) presents these as a dropdown; the chosen `id` arrives
// as ?feed=<id>. Keep ids short, lowercase, and stable (they are the public
// config contract). To add a feed: append an entry here, confirm it parses
// (`bun test` covers the parser, not the live URL), and it shows up everywhere.
//
// `category` is purely organizational (used to group the app-store dropdown).
// All URLs were probed live; a few sources (npr, the-verge, longreads,
// petapixel) carry their imagery inside content:encoded/description HTML rather
// than media:* tags — the parser's image fallback chain handles that.

export type FeedCategory = 'general' | 'tech' | 'visual' | 'longform'

export interface Feed {
  id: string
  title: string
  url: string
  category: FeedCategory
}

export const FEEDS: Feed[] = [
  // ---- General news (US-centric) -----------------------------------------
  { id: 'npr', title: 'NPR — Top Stories', url: 'https://feeds.npr.org/1001/rss.xml', category: 'general' },
  {
    id: 'cbs',
    title: 'CBS News — Top Stories',
    url: 'https://www.cbsnews.com/latest/rss/main',
    category: 'general'
  },
  {
    id: 'nyt',
    title: 'The New York Times — Home',
    url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
    category: 'general'
  },
  {
    id: 'fox',
    title: 'Fox News — Latest',
    url: 'https://moxie.foxnews.com/google-publisher/latest.xml',
    category: 'general'
  },
  {
    id: 'abc',
    title: 'ABC News — Top Stories',
    url: 'https://abcnews.go.com/abcnews/topstories',
    category: 'general'
  },
  // Reuters retired its official RSS feeds; the Google News proxy is the
  // reliable way to surface Reuters wire copy. It is text-forward (no media).
  {
    id: 'reuters',
    title: 'Reuters — US',
    url: 'https://news.google.com/rss/search?q=site:reuters.com+when:1d&hl=en-US&gl=US&ceid=US:en',
    category: 'general'
  },
  {
    id: 'bbc-world',
    title: 'BBC News — World',
    url: 'http://feeds.bbci.co.uk/news/world/rss.xml',
    category: 'general'
  },

  // ---- Technology ---------------------------------------------------------
  {
    id: 'hacker-news',
    title: 'Hacker News — Front Page',
    url: 'https://hnrss.org/frontpage',
    category: 'tech'
  },
  { id: 'the-verge', title: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'tech' },
  {
    id: 'ars-technica',
    title: 'Ars Technica',
    url: 'https://feeds.arstechnica.com/arstechnica/index',
    category: 'tech'
  },

  // ---- Visual / Media RSS -------------------------------------------------
  {
    id: 'nasa-iotd',
    title: 'NASA — Image of the Day',
    url: 'https://www.nasa.gov/rss/dyn/lg_image_of_the_day.rss',
    category: 'visual'
  },
  {
    id: 'petapixel',
    title: 'PetaPixel — Photography',
    url: 'https://petapixel.com/feed/',
    category: 'visual'
  },

  // ---- Long-form / slow journalism ---------------------------------------
  {
    id: 'longreads',
    title: 'Longreads',
    url: 'https://longreads.com/feed/',
    category: 'longform'
  }
]

// The feed shown when ?feed= is absent or unknown.
export const DEFAULT_FEED_ID = 'npr'

const FEEDS_BY_ID = new Map(FEEDS.map((feed) => [feed.id, feed]))

export const getFeed = (id: string | undefined | null): Feed | undefined =>
  id ? FEEDS_BY_ID.get(id) : undefined

export const defaultFeed = (): Feed => FEEDS_BY_ID.get(DEFAULT_FEED_ID) as Feed
