# Frontend Guide

The frontend is a **zero-build** static site. Every `.js` file is loaded
as a `<script defer>`. There is no bundler, no TypeScript, no npm.

## Pages

| File | Role |
|---|---|
| `index.html` | Landing page — hero, features, 3D India globe, on-page demo recommender |
| `dashboard.html` | 14-tool dashboard — the main application |
| `farm-boundary.html` | Draw-a-polygon tool backed by Leaflet + SoilGrids |

## Script layering (load order)

All scripts use `defer`, so they execute after HTML parsing in declaration
order. `mm-core.js` must load before `dashboard.js` (it bootstraps the
Farm Profile bar); `mm-enhance.js` loads after so it can observe
`dashboard.js`'s outputs.

```
chart.js / three.js   (CDN)
└── mm-core.js        (shared utilities, Farm Profile, share menu, a11y)
    └── site-ui.js    (nav, counters, PWA register)
        └── dashboard.js / state-data.js / india-globe.js / demo-recommender.js
            └── mm-enhance.js   (dashboard-only UX decoration)
                └── i18n.js · toolbar.js · chatbot.js
```

## Module responsibilities

### `mm-core.js` — the cross-page utility layer

Exposes a single `window.MM` namespace:

```js
MM.fmt.inr(120000)        // "₹1.20 L"
MM.fmt.weight(3400)       // "3,400 kg" (or "34 q" if unit = quintal)
MM.profile.get()          // { region_id, season, area_acres, budget_per_acre, crop_id }
MM.profile.set({ ... })   // persists + fires 'mm:profile-changed' + auto-fills forms
MM.share.whatsapp(text)
MM.share.print()
MM.toast("Saved")
```

Also owns:

- **Farm Profile bar** — auto-injected on the dashboard (`.dashx__wrap`).
  Fills every form field named like a profile key (`region_id`, `season`,
  `area_acres`, `budget_per_acre`, `crop_id`).
- **Deep-linking** — `/dashboard.html?tool=simulate&region_id=mh_pune&crop_id=cotton`
  activates that tool and applies the profile.
- **Tools menu** (bottom-left ⋮) — WhatsApp share, print/PDF, copy link,
  high-contrast, large-text, PWA install prompt.
- **Print stylesheet** — hides nav, sidebar, chat, tools menu, form
  submit buttons.

### `dashboard.js` — the 14 tools

Each tool is a section in `dashboard.html` with:

- `<form data-form="tool-name">` — user inputs.
- `<div class="output" data-out="tool-name"></div>` — result target.

Tool categories (see the left sidebar in `dashboard.html`):

| Group | Tools |
|---|---|
| Plan | Smart recommend · Yield & profit · Rotation planner |
| Strategies | Strategy templates · Compare crops · Optimal mix |
| Market | Price forecast · Sell advisor · MSP comparison · Cross-mandi arbitrage |
| Advisory | Pest alerts · Irrigation · Fertilizer · Crop calendar · Soil projection |
| Finance | Loan calculator · Expense tracker · Government schemes |
| System | ML model status |

### `mm-enhance.js` — non-invasive UX layer

Uses a `MutationObserver` on every `.output[data-out]` container. When
`dashboard.js` renders results it:

- Adds a **"Why this crop?"** `<details>` drawer to each recommendation row with a bar chart of factors (smart score, yield, ROI, inverse risk).
- Converts the bare `XX/100` risk number into a coloured **gauge** with Low/Moderate/High tag.
- Appends a **"Data as of · Source"** footer disclosing provenance (crop parameters, mandi prices from agmarknet-compatible CSV, MSP from CACP, etc.).

### `chatbot.js` — draggable floating assistant

- Draggable FAB, position saved to `localStorage`.
- Markdown rendering with support for **bold**, `code`, ` ```blocks``` `, bullet lists, headings, pipe tables, links.
- Renders chatbot `actions` array as green pill buttons → deep-link into the dashboard.
- **Voice input** via `webkitSpeechRecognition` (Chrome / Edge). Language follows `document.documentElement.lang`.
- **Session memory** — mirrors backend `context` into `localStorage` (`mm_chat_ctx`). Bootstraps region from the Farm Profile on first open.
- **Slash-command** placeholder in the input hints at `/recommend /msp /pest`.

See [`CHATBOT.md`](./CHATBOT.md) for server-side intent details.

### `india-globe.js`

Three.js scene of India with clickable states, multiple heat-map modes
(rainfall / soil N / avg profit / per-crop suitability). Data comes from
`state-data.js` (static reference data for all 36 states + UTs).

### `site-ui.js`

Nav, scroll animations, number counters, and **service-worker
registration** (`navigator.serviceWorker.register('/sw.js')` once the
document loads).

### `i18n.js`

Simple string table for English / Hindi / Telugu. Uses
`data-i18n="key"` attributes on static markup.

### `toolbar.js`

Floating action toolbar with dark-mode toggle, command-aware voice input
(parses _"simulate rice in Punjab for 5 acres"_), read-aloud TTS,
WhatsApp share, PDF export. Independent of `mm-core.js`'s tools menu —
both can coexist.

### `sw.js` — service worker

Three strategies baked in:

- **Precache the shell** on install (HTML, CSS, all `.js` above, manifest).
- **Network-first for HTML** — avoids stale HTML after a deploy.
- **Cache-first for same-origin static assets** (fonts, images).
- **Stale-while-revalidate for CDN libs** (Chart.js, Three.js).
- **Network-only for `/api/*`** — never cache dynamic data.

Bump `VERSION` in `sw.js` whenever you ship new assets so old caches get
evicted on `activate`.

## Design system

Warm-earth "clay" palette. Display font **Fraunces**, body **Inter**.
All tokens as CSS custom properties in `style.css`. Dark mode is a theme
flip via `html[data-theme="dark"]`. Accessibility toggles in
`mm-core.js` add `body.mm-hc` (high contrast) and `body.mm-lg` (large
text).

## Accessibility

- Keyboard-navigable — sidebar buttons, form fields, tools menu.
- `aria-label` on every icon button.
- Voice input on the chatbot.
- Large-text + high-contrast body modes.
- Print stylesheet for PDF export of the current tool.

## Extending

- **A new dashboard tool:** add a `<section class="tool" data-tool="x">…</section>` with a form `data-form="x"` and an output `data-out="x"`. Wire a submit handler in `dashboard.js`. The Farm Profile bar will auto-fill fields named like profile keys, and `mm-enhance.js` will auto-add the "Data as of" footer.
- **A new chatbot intent:** add a handler in `backend/chatbot.py` and a regex branch in `answer()`. Include deep-link `actions` via `_build_actions()` so the reply drives the user back into the dashboard.
- **A new language:** extend the table in `i18n.js`; mark static strings with `data-i18n="key"`.
