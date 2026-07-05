import { describe, expect, it } from 'bun:test'
import { decodeEntities, firstImageInHtml, parseFeed, parseXml, stripHtml } from './parse'

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:media="http://search.yahoo.com/mrss/"
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Test Channel</title>
    <item>
      <title>First &amp; Foremost</title>
      <link>https://example.com/first</link>
      <pubDate>Mon, 29 Jun 2026 10:00:00 GMT</pubDate>
      <description><![CDATA[<p>Hello <img src="https://img.example/in-desc.jpg" /> world.</p>]]></description>
      <media:content url="https://img.example/small.jpg" type="image/jpeg" width="320" />
      <media:content url="https://img.example/big.jpg" type="image/jpeg" width="1200" />
      <media:thumbnail url="https://img.example/thumb.jpg" />
    </item>
    <item>
      <title>Older Story</title>
      <link>https://example.com/older</link>
      <pubDate>Sun, 28 Jun 2026 10:00:00 GMT</pubDate>
      <description>Plain text summary.</description>
    </item>
  </channel>
</rss>`

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <title>Atom Feed</title>
  <entry>
    <title>Video Item</title>
    <link rel="alternate" href="https://example.com/video" />
    <link rel="edit" href="https://example.com/edit" />
    <published>2026-06-29T12:00:00Z</published>
    <summary>Watch this.</summary>
    <media:group>
      <media:thumbnail url="https://img.example/yt.jpg" width="480" />
      <media:content url="https://v.example/video.mp4" type="video/mp4" />
    </media:group>
  </entry>
</feed>`

describe('parseFeed — RSS 2.0', () => {
  const parsed = parseFeed(RSS)

  it('reads the channel title', () => {
    expect(parsed.title).toBe('Test Channel')
  })

  it('returns items newest-first and decodes entities in titles', () => {
    expect(parsed.items.map((i) => i.title)).toEqual(['First & Foremost', 'Older Story'])
  })

  it('prefers the widest media:content image', () => {
    expect(parsed.items[0].image).toBe('https://img.example/big.jpg')
    expect(parsed.items[0].media).toEqual({ type: 'image', url: 'https://img.example/big.jpg' })
  })

  it('strips HTML from the description for the summary', () => {
    expect(parsed.items[0].summary).toBe('Hello world.')
  })

  it('parses pubDate into an epoch and sorts by it', () => {
    expect(parsed.items[0].publishedAt).toBe(Date.parse('Mon, 29 Jun 2026 10:00:00 GMT'))
    expect((parsed.items[0].publishedAt ?? 0) > (parsed.items[1].publishedAt ?? 0)).toBe(true)
  })

  it('leaves image/media null for a text-only item', () => {
    expect(parsed.items[1].image).toBeNull()
    expect(parsed.items[1].media).toBeNull()
    expect(parsed.items[1].summary).toBe('Plain text summary.')
  })
})

describe('parseFeed — Atom + Media RSS group', () => {
  const parsed = parseFeed(ATOM)

  it('reads the feed title and the alternate link', () => {
    expect(parsed.title).toBe('Atom Feed')
    expect(parsed.items[0].link).toBe('https://example.com/video')
  })

  it('uses the group thumbnail as the image and the video as the media', () => {
    expect(parsed.items[0].image).toBe('https://img.example/yt.jpg')
    expect(parsed.items[0].media).toEqual({ type: 'video', url: 'https://v.example/video.mp4' })
  })

  it('parses the ISO published date', () => {
    expect(parsed.items[0].publishedAt).toBe(Date.parse('2026-06-29T12:00:00Z'))
  })
})

describe('parseFeed — image fallback chain', () => {
  it('falls back to an image enclosure', () => {
    const xml = `<rss version="2.0"><channel><item>
      <title>Enc</title><link>https://e/1</link>
      <enclosure url="https://img.example/enc.jpg" type="image/jpeg" length="12345" />
    </item></channel></rss>`
    expect(parseFeed(xml).items[0].image).toBe('https://img.example/enc.jpg')
  })

  it('falls back to the first <img> inside content:encoded', () => {
    const xml = `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
      <channel><item>
      <title>Body image</title><link>https://e/2</link>
      <description>No media here.</description>
      <content:encoded><![CDATA[<p>Lead.</p><img src='https://img.example/body.png' alt='x'>]]></content:encoded>
    </item></channel></rss>`
    expect(parseFeed(xml).items[0].image).toBe('https://img.example/body.png')
  })

  it('detects an audio enclosure as podcast media', () => {
    const xml = `<rss version="2.0"><channel><item>
      <title>Pod</title><link>https://e/3</link>
      <enclosure url="https://a.example/ep.mp3" type="audio/mpeg" length="999" />
    </item></channel></rss>`
    expect(parseFeed(xml).items[0].media).toEqual({ type: 'audio', url: 'https://a.example/ep.mp3' })
  })
})

describe('parseFeed — comic variant (xkcd)', () => {
  // xkcd escapes the whole <img> into <description>; the joke is its title/alt.
  const xml = `<rss version="2.0"><channel><title>xkcd.com</title><item>
    <title>Types of Tornado Alert</title>
    <link>https://xkcd.com/3267/</link>
    <pubDate>Fri, 03 Jul 2026 04:00:00 -0000</pubDate>
    <description>&lt;img src="https://imgs.xkcd.com/comics/types_of_tornado_alert.png" title="I hate the unearthly sound my phone makes." alt="I hate the unearthly sound my phone makes." /&gt;</description>
  </item></channel></rss>`

  it('lifts the image title/alt text into the summary', () => {
    const item = parseFeed(xml, { variant: 'comic' }).items[0]
    expect(item.image).toBe('https://imgs.xkcd.com/comics/types_of_tornado_alert.png')
    expect(item.summary).toBe('I hate the unearthly sound my phone makes.')
  })

  it('leaves the summary empty without the variant (default pipeline)', () => {
    expect(parseFeed(xml).items[0].summary).toBe('')
  })
})

describe('parseXml + helpers', () => {
  it('handles CDATA, comments and self-closing tags without throwing', () => {
    const doc = parseXml('<r><!-- c --><a x="1"/><b><![CDATA[<keep>]]></b></r>')
    expect(doc.children[0].name).toBe('r')
  })

  it('decodes numeric and named entities', () => {
    expect(decodeEntities('a &amp; b &#39;c&#39; &#x2014; &mdash;')).toBe("a & b 'c' — —")
  })

  it('strips tags and collapses whitespace', () => {
    expect(stripHtml('<p>one</p>\n  <b>two</b>')).toBe('one two')
  })

  it('finds the first image src regardless of quote style', () => {
    expect(firstImageInHtml(`<img src='https://x/y.jpg'>`)).toBe('https://x/y.jpg')
    expect(firstImageInHtml('<p>no image</p>')).toBeNull()
  })

  it('caps how many items it returns', () => {
    const items = Array.from({ length: 50 }, (_, i) => `<item><title>t${i}</title><link>l${i}</link></item>`).join('')
    const xml = `<rss version="2.0"><channel><title>Big</title>${items}</channel></rss>`
    expect(parseFeed(xml, { max: 5 }).items).toHaveLength(5)
  })
})

describe('parseFeed — entities, double-decode, relative URLs, xhtml', () => {
  it('decodes a broad set of named entities in titles (no garbled markup)', () => {
    const xml = `<rss version="2.0"><channel><item>
      <title>S&atilde;o Paulo: &pound;5 or &euro;3 &mdash; &frac12; off</title>
      <link>https://e/1</link>
    </item></channel></rss>`
    expect(parseFeed(xml).items[0].title).toBe('São Paulo: £5 or €3 — ½ off')
  })

  it('decodes double-escaped HTML entities in descriptions (Fox / Google News style)', () => {
    // Many feeds double-escape their description HTML, so entities inside it
    // (&amp;apos; / &amp;eacute;) need a second decode after the tags are stripped.
    const xml = `<rss version="2.0"><channel><item>
      <title>T</title><link>https://e/2</link>
      <description>&lt;p&gt;Tommy Paul&amp;apos;s caf&amp;eacute; &amp;amp; more&lt;/p&gt;</description>
    </item></channel></rss>`
    expect(parseFeed(xml).items[0].summary).toBe("Tommy Paul's café & more")
  })

  it('compacts hnrss boilerplate into a points/comments line', () => {
    const xml = `<rss version="2.0"><channel><item>
      <title>Some Story</title><link>https://news.ycombinator.com/item?id=1</link>
      <description>Article URL: https://x.example/a Comments URL: https://news.ycombinator.com/item?id=1 Points: 17 # Comments: 2</description>
    </item></channel></rss>`
    expect(parseFeed(xml).items[0].summary).toBe('17 points · 2 comments')
  })

  it('strips the " - Source" suffix and drops the echo summary for Google News', () => {
    const xml = `<rss version="2.0"><channel><item>
      <title>Big News - Reuters</title>
      <link>https://news.google.com/articles/abc</link>
      <source url="https://reuters.com">Reuters</source>
      <description>Big News &amp;nbsp;&amp;nbsp; Reuters</description>
    </item></channel></rss>`
    const item = parseFeed(xml, { baseUrl: 'https://news.google.com/rss/search?q=x' }).items[0]
    expect(item.title).toBe('Big News')
    expect(item.summary).toBe('')
  })

  it('trims trailing read-more boilerplate from summaries', () => {
    const xml = `<rss version="2.0"><channel><item>
      <title>Photo Story</title><link>https://e/1</link>
      <description><![CDATA[<p>A great photo essay. [ Read More ]</p>]]></description>
    </item></channel></rss>`
    expect(parseFeed(xml).items[0].summary).toBe('A great photo essay.')
  })

  it('resolves relative item and image URLs against the feed base', () => {
    const xml = `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
      <channel><item>
        <title>Rel</title>
        <link>/news/story</link>
        <content:encoded><![CDATA[<img src="/img/x.jpg">]]></content:encoded>
      </item></channel></rss>`
    const item = parseFeed(xml, { baseUrl: 'https://site.example/feed.xml' }).items[0]
    expect(item.link).toBe('https://site.example/news/story')
    expect(item.image).toBe('https://site.example/img/x.jpg')
  })

  it('upgrades a BBC ichef thumbnail to a large real rendition (no fetch needed)', () => {
    const xml = `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><item>
      <title>BBC</title><link>https://bbc.co.uk/news/1</link>
      <media:thumbnail width="240" height="135"
        url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/abcd/live/x.jpg" />
    </item></channel></rss>`
    const item = parseFeed(xml).items[0]
    expect(item.image).toBe('https://ichef.bbci.co.uk/ace/standard/2048/cpsprodpb/abcd/live/x.jpg')
    expect(item.lowResImage).toBeUndefined()
  })

  it('flags a generic small thumbnail as low-res (for server-side og:image upgrade)', () => {
    const xml = `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><item>
      <title>T</title><link>https://abcnews.go.com/x</link>
      <media:thumbnail width="384" height="288" url="https://s.abcnews.com/images/x_384.jpg" />
    </item></channel></rss>`
    expect(parseFeed(xml).items[0].lowResImage).toBe(true)
  })

  it('drops hotlink-protected Reddit preview images', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
      <entry><title>R</title><link rel="alternate" href="https://reddit.com/x" />
        <media:thumbnail url="https://external-preview.redd.it/abc.png?width=320" />
      </entry></feed>`
    const item = parseFeed(xml).items[0]
    expect(item.image).toBeNull()
  })

  it('does not flag a wide media:content image', () => {
    const xml = `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><item>
      <title>Big</title><link>https://e/1</link>
      <media:content url="https://img.example/big.jpg" type="image/jpeg" width="1200" />
    </item></channel></rss>`
    expect(parseFeed(xml).items[0].lowResImage).toBeUndefined()
  })

  it('extracts summary and image from Atom type="xhtml" content', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
      <title>X</title>
      <entry>
        <title>Inline XHTML</title>
        <link rel="alternate" href="https://e/3" />
        <content type="xhtml"><div>Hello <img src="https://img.example/x.jpg" /> world</div></content>
      </entry>
    </feed>`
    const item = parseFeed(xml).items[0]
    expect(item.image).toBe('https://img.example/x.jpg')
    expect(item.summary).toContain('Hello')
    expect(item.summary).toContain('world')
  })
})
