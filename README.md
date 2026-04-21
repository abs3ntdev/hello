# hello

Minimal personal homepage. A sidebar of icons on the left; each one opens the
configured site in an iframe on the right. Tabs stay alive when you switch, and
you can preload any subset on boot so switching is instant.

Inspired by [Organizr](https://github.com/causefx/Organizr), but only the
sidebar + iframe feature — no widgets, no dashboards, no auth (use a reverse
proxy or your existing SSO). Written in Astro + TypeScript, shipped as a Docker
image.

## Features

- Sidebar of configurable icons; clicking one shows that site in a full-bleed
  iframe on the right.
- Iframes are **never destroyed on switch** — hidden with `display: none`, so
  scroll position, running JS, open WebSockets, and playing video all survive.
- Optional **preload**: iframes marked `preload: true` are built at boot while
  hidden, so the first time you click them they're already loaded.
- **Groups**: organize tabs into labeled sections with thin dividers.
- **Middle-click or Ctrl/Cmd-click** a sidebar icon to open that URL in a real
  new browser tab (handy when a site blocks embedding).
- **Floating reload button** reloads the current iframe without touching the
  others; a small spinner on the button shows load progress.
- **Installable PWA** — your browser's install prompt will offer a standalone
  window and app icon.
- **Catppuccin Mocha** theme out of the box.
- **JSON Schema** for `config.json` — editor autocomplete and validation.
- [selfh.st/icons](https://selfh.st/icons) integration with a `sh-` prefix that
  mirrors homepage/dashy, plus an explicit `selfhst:` form with light/dark
  variant support.
- URL hash routing: `/#plex` deep-links to a specific tab.

## Quick start (Docker / Unraid)

```sh
# from a clone of this repo
cp config/config.example.json config/config.json
# edit config/config.json — add your sites
docker compose up -d
# open http://your-host:3000
```

On Unraid: add a new container pointing at the built image, map port `3000`,
and mount a host path (e.g. `/mnt/user/appdata/hello`) to `/config` inside the
container. Drop your `config.json` into that host path.

## Config

`config/config.json` (mounted to `/config/config.json` in the container) is
read fresh on every request — edit it and refresh the page to see changes, no
restart needed.

```json
{
  "title": "hello",
  "defaultTab": "sonarr",
  "tabs": [
    {
      "id": "dash",
      "name": "Dashboard",
      "url": "https://example.com",
      "icon": "🏠"
    },

    {
      "id": "sonarr",
      "name": "Sonarr",
      "url": "https://sonarr.example.com",
      "icon": "sh-sonarr",
      "preload": true,
      "group": "Media"
    },
    {
      "id": "plex",
      "name": "Plex",
      "url": "https://plex.example.com",
      "icon": "selfhst:plex",
      "group": "Media"
    },

    {
      "id": "grafana",
      "name": "Grafana",
      "url": "https://grafana.example.com",
      "icon": "selfhst:grafana/light",
      "group": "Monitoring"
    }
  ]
}
```

Ungrouped tabs render at the top. Grouped tabs render in the order their group
label first appears in the config, with a thin divider between groups.

### Fields

| Field        | Type       | Required | Notes                                            |
| ------------ | ---------- | -------- | ------------------------------------------------ |
| `title`      | string     | no       | Brand text in the sidebar. Default `"hello"`.    |
| `defaultTab` | string     | no       | Tab `id` to open on first load. Default is the first tab. |
| `tabs`       | Tab[]      | yes      | At least one tab required.                       |
| `tabs[].id`  | string     | yes      | Unique; `[A-Za-z0-9_-]+`. Used in the URL hash.  |
| `tabs[].name`| string     | yes      | Shown in tooltip and page title.                 |
| `tabs[].url` | string     | yes      | The URL to load in the iframe.                   |
| `tabs[].icon`| string     | yes      | See [Icons](#icons) below.                       |
| `tabs[].preload` | boolean | no      | If true, iframe is created at boot (hidden) so it's warm on first click. |
| `tabs[].group`   | string  | no      | Group label. Tabs sharing a group render together, with a divider between groups. |
| `tabs[].sandbox` | string  | no      | iframe `sandbox` attribute (space-separated tokens). |
| `tabs[].allow`   | string  | no      | iframe `allow` attribute.                        |

Invalid config throws on page load — the error shows the bad field. Missing
config falls back to a one-tab example so the container doesn't hard-fail.

### Editor autocomplete (JSON Schema)

A JSON Schema is bundled with the repo and also served by the app. Add a
`$schema` line to the top of your `config.json` and most editors (VS Code,
Zed, JetBrains, neovim with SchemaStore) will give you tab completion,
inline docs, and red squiggles on typos.

**Option A — pin to the repo (recommended, doesn't require the app to be up):**
```json
{
  "$schema": "https://raw.githubusercontent.com/abs3ntdev/hello/main/schema/config.schema.json",
  "title": "hello",
  "tabs": [ ... ]
}
```

**Option B — pin to your running deployment:**
```json
{
  "$schema": "https://hello.asdf.cafe/schema/config.json",
  "title": "hello",
  ...
}
```

Or reference the local file inside the repo checkout:
```json
{
  "$schema": "./schema/config.schema.json"
}
```

## Icons

Five forms are supported:

1. **Emoji / text** — `"icon": "📺"`
2. **Absolute URL** — `"icon": "https://example.com/logo.png"`
3. **Local path** — `"icon": "/icons/custom.svg"` (served from `public/`)
4. **selfh.st, `sh-` form** (homepage/dashy compatible):
   - `"sh-plex"` → SVG
   - `"sh-plex.png"` / `".webp"` / `".avif"` / `".ico"` → explicit format
   - `"sh-plex-light"` → literal filename (for variants that aren't `light`/`dark`)
5. **selfh.st, explicit form** (supports typed variants):
   - `"selfhst:plex"` → SVG
   - `"selfhst:plex/light"` / `"selfhst:plex/dark"` → SVG variant
   - `"selfhst:plex.png"` → format override
   - `"selfhst:plex/dark.webp"` → variant + format

Default format is **SVG** (what selfh.st recommends when available). Browse the
catalog at <https://selfh.st/icons/>. Icons are served from the jsDelivr CDN
mirror of [`selfhst/icons`](https://github.com/selfhst/icons) pinned to `@main`.

## Mouse + keyboard

| Input                    | Action                                              |
| ------------------------ | --------------------------------------------------- |
| Click a sidebar icon     | Switch to that tab                                  |
| Middle-click             | Open the tab's URL in a real new browser tab        |
| Ctrl/Cmd + click         | Open the tab's URL in a real new browser tab        |
| Floating reload button   | Reload the currently visible tab's iframe           |
| `#<id>` in URL           | Deep-link to a specific tab                         |

## How tab switching works

The trick (lifted straight from Organizr's `switchTab`):

1. One `<div class="frame-container">` per tab is server-rendered up front,
   initially `display: none` except the default tab's.
2. The `<iframe>` inside is created lazily the first time you switch to a tab,
   OR eagerly at boot if the tab is marked `preload: true`.
3. Switching tabs only toggles a `hidden` class on containers — iframes are
   never removed, so browsing state survives.

That's it. See `src/scripts/tabs.ts` for the client-side logic.

## Development

```sh
npm install
npm run dev        # http://localhost:4321 (astro dev)
npm run build      # produces ./dist with the Node adapter entry point
node dist/server/entry.mjs   # runs the built server on :3000
```

The dev server doesn't use Docker's `/config` path; it reads
`./config/config.json` from the repo. Override with `HELLO_CONFIG=/path/to.json`.

## Deploy targets

The image is a standalone Node server (via `@astrojs/node`). Any runtime that
can run a Node process and mount a config file will work — Docker, Docker
Compose, Unraid, a bare Node process behind a reverse proxy, etc. Put your
authentication at the reverse proxy layer.

## License

MIT.
