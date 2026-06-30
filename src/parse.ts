// Dependency-free RSS / Atom / Media-RSS parser.
//
// The Cloudflare Workers runtime has no DOMParser, so feeds are parsed here
// with a small hand-rolled XML tokenizer (handles CDATA, comments, attribute
// quoting, and namespaced tags like `media:content` / `content:encoded`).
// `parseFeed` normalizes RSS 2.0, RSS 1.0 (RDF), and Atom into one shape so the
// client never has to know the source format.
//
// Entity handling: parseXml stores text RAW (entities intact, CDATA literal);
// every consumer decodes exactly once (textOf / stripHtml / firstImageInHtml),
// so nothing is double-decoded.
//
// Image resolution is a fallback chain — many real feeds carry no media:* tag
// and bury their image in the body HTML:
//   media:content (image, widest) -> media:thumbnail -> image enclosure
//   -> itunes:image -> first <img> in content:encoded / description.
// Relative image/link URLs are resolved against the feed's own URL (baseUrl).

import { MAX_ITEMS } from './constants'

export interface FeedMedia {
  type: 'image' | 'audio' | 'video'
  url: string
}

export interface FeedItem {
  title: string
  link: string
  // Epoch ms of the publish date, or null if absent/unparseable. Used for
  // newest-first sorting; the client renders it as relative time.
  publishedAt: number | null
  // Plain-text summary (HTML stripped, entities decoded); may be ''.
  summary: string
  // Best image URL for the item, or null (the client uses a text-only layout).
  image: string | null
  // Primary attached media (audio/video enclosure, else the image), or null.
  media: FeedMedia | null
}

export interface ParsedFeed {
  title: string
  items: FeedItem[]
}

export interface ParseOptions {
  // The feed's own URL, used to resolve relative item/image links.
  baseUrl?: string
  max?: number
}

interface XmlNode {
  // Qualified tag name, lowercased: 'item', 'media:content', 'content:encoded'.
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  // Concatenated direct text, kept RAW (entities undecoded, CDATA literal).
  text: string
}

// A broad set of named entities (the XML five plus the common HTML/Latin-1
// set). Anything not listed is left untouched rather than guessed at.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', shy: '',
  ndash: '–', mdash: '—', hellip: '…', middot: '·', bull: '•',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›', prime: '′', Prime: '″',
  copy: '©', reg: '®', trade: '™', deg: '°', sect: '§', para: '¶',
  micro: 'µ', plusmn: '±', times: '×', divide: '÷', minus: '−',
  frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³', sup1: '¹',
  euro: '€', pound: '£', cent: '¢', yen: '¥', curren: '¤',
  dagger: '†', Dagger: '‡', permil: '‰', not: '¬', iquest: '¿', iexcl: '¡',
  aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ',
  Aacute: 'Á', Agrave: 'À', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å', AElig: 'Æ',
  ccedil: 'ç', Ccedil: 'Ç',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
  Eacute: 'É', Egrave: 'È', Ecirc: 'Ê', Euml: 'Ë',
  iacute: 'í', igrave: 'ì', icirc: 'î', iuml: 'ï',
  Iacute: 'Í', Igrave: 'Ì', Icirc: 'Î', Iuml: 'Ï',
  ntilde: 'ñ', Ntilde: 'Ñ',
  oacute: 'ó', ograve: 'ò', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø', oelig: 'œ',
  Oacute: 'Ó', Ograve: 'Ò', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø', OElig: 'Œ',
  uacute: 'ú', ugrave: 'ù', ucirc: 'û', uuml: 'ü',
  Uacute: 'Ú', Ugrave: 'Ù', Ucirc: 'Û', Uuml: 'Ü',
  yacute: 'ý', yuml: 'ÿ', szlig: 'ß'
}

const fromCodePoint = (cp: number): string => {
  try {
    return String.fromCodePoint(cp)
  } catch {
    return ''
  }
}

export const decodeEntities = (input: string): string => {
  if (!input.includes('&')) return input
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, code: string) => {
    if (code[0] === '#') {
      const isHex = code[1] === 'x' || code[1] === 'X'
      const cp = isHex ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10)
      return Number.isFinite(cp) ? fromCodePoint(cp) : match
    }
    // Named entities are case-sensitive (e.g. &Aacute; vs &aacute;).
    const named = NAMED_ENTITIES[code]
    return named ?? match
  })
}

// Module-level (the /g lastIndex resets to 0 when exec() returns null, so reuse
// across calls is safe) to avoid recompiling the regex for every tag.
const ATTR_RE = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g

const parseTag = (raw: string): { name: string; attrs: Record<string, string> } => {
  const content = raw.trim()
  const nameMatch = /^([^\s/]+)/.exec(content)
  const name = (nameMatch ? nameMatch[1] : content).toLowerCase()
  const attrs: Record<string, string> = {}
  const rest = content.slice(name.length)
  let match = ATTR_RE.exec(rest)
  while (match) {
    const key = match[1].toLowerCase()
    const value = match[3] ?? match[4] ?? match[5] ?? ''
    attrs[key] = decodeEntities(value)
    match = ATTR_RE.exec(rest)
  }
  return { name, attrs }
}

// Tokenize the document into a tree. Lenient by design: malformed or mismatched
// tags degrade gracefully rather than throwing on real-world feeds. Text is
// stored RAW; consumers decode once.
export const parseXml = (input: string): XmlNode => {
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]
  const top = (): XmlNode => stack[stack.length - 1]
  const n = input.length
  let i = input.charCodeAt(0) === 0xfeff ? 1 : 0

  while (i < n) {
    const lt = input.indexOf('<', i)
    if (lt === -1) {
      top().text += input.slice(i)
      break
    }
    if (lt > i) top().text += input.slice(i, lt)

    if (input.startsWith('<!--', lt)) {
      const end = input.indexOf('-->', lt + 4)
      i = end === -1 ? n : end + 3
      continue
    }
    if (input.startsWith('<![CDATA[', lt)) {
      const end = input.indexOf(']]>', lt + 9)
      top().text += input.slice(lt + 9, end === -1 ? n : end)
      i = end === -1 ? n : end + 3
      continue
    }
    if (input.startsWith('<!', lt)) {
      const end = input.indexOf('>', lt + 2)
      i = end === -1 ? n : end + 1
      continue
    }
    if (input.startsWith('<?', lt)) {
      const end = input.indexOf('?>', lt + 2)
      i = end === -1 ? n : end + 2
      continue
    }

    // Find the tag's closing '>', skipping any inside quoted attribute values.
    let j = lt + 1
    let quote = ''
    while (j < n) {
      const ch = input[j]
      if (quote) {
        if (ch === quote) quote = ''
      } else if (ch === '"' || ch === "'") {
        quote = ch
      } else if (ch === '>') {
        break
      }
      j++
    }
    const tagContent = input.slice(lt + 1, j)
    i = j + 1

    if (tagContent[0] === '/') {
      const name = tagContent.slice(1).trim().toLowerCase()
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k
          break
        }
      }
      continue
    }

    let body = tagContent
    let selfClose = false
    if (body.endsWith('/')) {
      selfClose = true
      body = body.slice(0, -1)
    }
    const { name, attrs } = parseTag(body)
    if (!name) continue
    const node: XmlNode = { name, attrs, children: [], text: '' }
    top().children.push(node)
    if (!selfClose) stack.push(node)
  }

  return root
}

const kids = (node: XmlNode, name: string): XmlNode[] =>
  node.children.filter((child) => child.name === name)

const kid = (node: XmlNode, name: string): XmlNode | undefined =>
  node.children.find((child) => child.name === name)

// Index-based walk (not queue.shift(), which is O(n) per call and makes the
// traversal O(n^2)). Order is a stack/DFS rather than BFS, which is fine — both
// callers look up tags by name, not by tree position.
const findDeep = (node: XmlNode, name: string): XmlNode | undefined => {
  const stack = [...node.children]
  for (let i = 0; i < stack.length; i++) {
    const current = stack[i]
    if (current.name === name) return current
    stack.push(...current.children)
  }
  return undefined
}

const findAllDeep = (node: XmlNode, name: string): XmlNode[] => {
  const out: XmlNode[] = []
  const stack = [...node.children]
  for (let i = 0; i < stack.length; i++) {
    const current = stack[i]
    if (current.name === name) out.push(current)
    stack.push(...current.children)
  }
  return out
}

// Raw concatenated direct text (entities intact).
const rawText = (node: XmlNode | undefined): string => (node ? node.text : '')

// Plain text for a leaf field: decode entities once, trim.
const textOf = (node: XmlNode | undefined): string => decodeEntities(rawText(node)).trim()

// HTML body of a node. For the common case the body is escaped/CDATA text held
// in node.text. For Atom type="xhtml" the body is parsed element children, so
// serialize them (keeping <img src>) — this is what lets xhtml entries surface
// a summary and image.
const htmlOf = (node: XmlNode | undefined): string => {
  if (!node) return ''
  if (node.text.trim()) return node.text
  if (node.children.length === 0) return ''
  return serialize(node)
}

const serialize = (node: XmlNode): string =>
  node.children
    .map((child) => {
      // Mixed content: keep both this node's text and its element children
      // (the parser stores them separately), so a nested <img> isn't dropped.
      const inner = `${child.text}${serialize(child)}`
      const src = child.name === 'img' && child.attrs.src ? ` src="${child.attrs.src}"` : ''
      return `<${child.name}${src}>${inner}</${child.name}>`
    })
    .join(' ')

// Strip tags + decode entities + collapse whitespace. Decodes BEFORE stripping
// so escaped HTML (&lt;p&gt;...) is treated as markup, matching how a browser
// renders an RSS description. Input is RAW; decode happens once here.
export const stripHtml = (html: string): string =>
  decodeEntities(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const IMG_RE = /<img\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))/i

// First <img> src in a (RAW) HTML string. Decodes once so escaped markup
// (&lt;img ...&gt;) is matched too.
export const firstImageInHtml = (html: string): string | null => {
  const match = IMG_RE.exec(decodeEntities(html))
  if (!match) return null
  return (match[2] ?? match[3] ?? match[4] ?? '') || null
}

// Resolve a possibly-relative URL against the feed's base. Absolute URLs pass
// through normalized; if there is no base and the URL is relative, it is
// returned unchanged (the client then treats a relative image as unusable).
const resolveUrl = (url: string, base?: string): string => {
  if (!url) return url
  try {
    return new URL(url, base || undefined).toString()
  } catch {
    return url
  }
}

const parseDate = (value: string): number | null => {
  if (!value) return null
  const t = Date.parse(value.trim())
  return Number.isNaN(t) ? null : t
}

const clip = (text: string, max: number): string => {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

const isImageType = (type: string, medium: string, url: string): boolean => {
  if (medium === 'image') return true
  if (type.startsWith('image/')) return true
  if (!type && !medium && /\.(jpe?g|png|gif|webp|avif)(\?|#|$)/i.test(url)) return true
  return false
}

// media:content / media:thumbnail elements live directly on the item or grouped
// under media:group; gather both, by tag name.
const mediaElements = (item: XmlNode, name: string): XmlNode[] => [
  ...kids(item, name),
  ...kids(item, 'media:group').flatMap((group) => kids(group, name))
]

const mediaContents = (item: XmlNode): XmlNode[] => mediaElements(item, 'media:content')
const mediaThumbs = (item: XmlNode): XmlNode[] => mediaElements(item, 'media:thumbnail')

const pickImage = (item: XmlNode, contentHtml: string): string | null => {
  const images = mediaContents(item).filter(
    (node) => node.attrs.url && isImageType(node.attrs.type ?? '', node.attrs.medium ?? '', node.attrs.url)
  )
  if (images.length > 0) {
    images.sort(
      (a, b) =>
        Number.parseInt(b.attrs.width ?? '0', 10) - Number.parseInt(a.attrs.width ?? '0', 10)
    )
    return images[0].attrs.url
  }

  const thumb = mediaThumbs(item).find((node) => node.attrs.url)
  if (thumb) return thumb.attrs.url

  const enclosure = kids(item, 'enclosure').find(
    (node) => node.attrs.url && isImageType(node.attrs.type ?? '', '', node.attrs.url)
  )
  if (enclosure) return enclosure.attrs.url

  const itunes = kid(item, 'itunes:image')
  if (itunes?.attrs.href) return itunes.attrs.href

  return firstImageInHtml(contentHtml)
}

const pickMedia = (item: XmlNode, image: string | null): FeedMedia | null => {
  const sources = [
    ...kids(item, 'enclosure').map((node) => ({
      url: node.attrs.url ?? '',
      type: node.attrs.type ?? '',
      medium: ''
    })),
    ...mediaContents(item).map((node) => ({
      url: node.attrs.url ?? '',
      type: node.attrs.type ?? '',
      medium: node.attrs.medium ?? ''
    }))
  ].filter((source) => source.url)

  const video = sources.find((s) => s.medium === 'video' || s.type.startsWith('video/'))
  if (video) return { type: 'video', url: video.url }

  const audio = sources.find((s) => s.medium === 'audio' || s.type.startsWith('audio/'))
  if (audio) return { type: 'audio', url: audio.url }

  return image ? { type: 'image', url: image } : null
}

const extractLink = (item: XmlNode, isAtom: boolean): string => {
  if (isAtom) {
    const links = kids(item, 'link')
    const alternate = links.find((link) => (link.attrs.rel ?? 'alternate') === 'alternate')
    const chosen = alternate ?? links[0]
    return chosen?.attrs.href ?? textOf(kid(item, 'id'))
  }
  const link = textOf(kid(item, 'link'))
  if (link) return link
  const guid = kid(item, 'guid')
  if (guid && (guid.attrs.ispermalink ?? 'true') !== 'false') return textOf(guid)
  return ''
}

const normalizeItem = (item: XmlNode, isAtom: boolean, baseUrl?: string): FeedItem => {
  const title = stripHtml(htmlOf(kid(item, 'title')))
  const link = resolveUrl(extractLink(item, isAtom), baseUrl)

  const dateStr = isAtom
    ? textOf(kid(item, 'published')) || textOf(kid(item, 'updated'))
    : textOf(kid(item, 'pubdate')) || textOf(kid(item, 'dc:date'))
  const publishedAt = parseDate(dateStr)

  const contentHtml =
    htmlOf(kid(item, 'content:encoded')) ||
    (isAtom ? htmlOf(kid(item, 'content')) : '') ||
    htmlOf(kid(item, 'description')) ||
    (isAtom ? htmlOf(kid(item, 'summary')) : '') ||
    htmlOf(kid(item, 'media:description'))

  const summaryHtml =
    (isAtom ? htmlOf(kid(item, 'summary')) : htmlOf(kid(item, 'description'))) ||
    htmlOf(kid(item, 'media:description')) ||
    contentHtml
  const summary = clip(stripHtml(summaryHtml), 500)

  const rawImage = pickImage(item, contentHtml)
  const image = rawImage ? resolveUrl(rawImage, baseUrl) : null
  const media = pickMedia(item, image)

  return { title, link, publishedAt, summary, image, media }
}

export const parseFeed = (xml: string, options: ParseOptions = {}): ParsedFeed => {
  const { baseUrl, max = MAX_ITEMS } = options
  const doc = parseXml(xml)

  const atom = findDeep(doc, 'feed')
  const rss = findDeep(doc, 'rss')
  const rdf = findDeep(doc, 'rdf:rdf')

  let isAtom = false
  let title = ''
  let itemNodes: XmlNode[] = []

  if (atom) {
    isAtom = true
    title = stripHtml(htmlOf(kid(atom, 'title')))
    itemNodes = kids(atom, 'entry')
  } else if (rss) {
    const channel = kid(rss, 'channel') ?? rss
    title = stripHtml(htmlOf(kid(channel, 'title')))
    itemNodes = kids(channel, 'item')
  } else if (rdf) {
    const channel = kid(rdf, 'channel')
    title = channel ? stripHtml(htmlOf(kid(channel, 'title'))) : ''
    itemNodes = kids(rdf, 'item')
  } else {
    itemNodes = findAllDeep(doc, 'item')
    if (itemNodes.length === 0) {
      itemNodes = findAllDeep(doc, 'entry')
      isAtom = itemNodes.length > 0
    }
  }

  const items = itemNodes
    .map((node) => normalizeItem(node, isAtom, baseUrl))
    .filter((item) => item.title || item.link)

  // Only re-sort when EVERY item is dated. Mixed feeds (e.g. CNN ships some
  // undated/evergreen items) would otherwise sink recent-but-undated stories
  // below a stale dated one; publishers already order feeds newest-first, so
  // trusting source order is safer than a partial-date sort.
  if (items.length > 0 && items.every((item) => item.publishedAt !== null)) {
    items.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
  }

  return { title, items: items.slice(0, max) }
}
