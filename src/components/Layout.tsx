import { html } from 'hono/html'
import type { Child } from 'hono/jsx'

interface LayoutProps {
  sentryId?: string
  gaId?: string
  v: string
  children?: Child
}

// Sentry / Google Analytics are optional: constants.ts ships empty IDs for this
// app, and these helpers render nothing when an ID is absent, so no broken
// script tags go out. Populate sentryIds/gaIds (per env) to enable them. When
// GA is on, main.ts tags every event with the feed `source`.
const sentryScript = (id?: string) =>
  id
    ? html`<script src="https://js.sentry-cdn.com/${id}.min.js" crossorigin="anonymous"></script>`
    : ''

const gaScript = (id?: string) =>
  id
    ? html`
      <script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>
      <script>
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());

        gtag('config', '${id}');
      </script>`
    : ''

const Layout = (props: LayoutProps) => html`<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>Screenly RSS Reader</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="description" content="A full-screen RSS / Media RSS reader for digital signage." />
      <!-- Unversioned to match the @font-face URLs in main.css, so the preload
           is actually used (no duplicate fetch). Fonts are cached immutably by
           the /static/fonts/* rule in index.tsx. -->
      <link
        rel="preload"
        href="/static/fonts/bricolage-grotesque-latin-standard-normal.woff2"
        as="font"
        type="font/woff2"
        crossorigin
      />
      <link
        rel="preload"
        href="/static/fonts/hanken-grotesk-latin-wght-normal.woff2"
        as="font"
        type="font/woff2"
        crossorigin
      />
      <link rel="stylesheet" href="/static/styles/main.css?v=${props.v}" />
      ${sentryScript(props.sentryId)}
      ${gaScript(props.gaId)}
      <!-- main.js is the bundled, self-executing classic script (no ES module
           export), so a plain async <script> runs it and any cached HTML stays
           compatible across deploys. The ?v= busts it whenever the bundle
           changes. It is built from main.ts/render.ts by build.ts. -->
      <script src="/static/js/main.js?v=${props.v}" async defer></script>
    </head>
    <body>
      ${props.children}
    </body>
  </html>`

export default Layout
