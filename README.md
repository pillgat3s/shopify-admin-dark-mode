# Shopify Admin Dark Mode

A dark mode toggle for the Shopify admin, in the top bar next to Sidekick.

It doesn't invert the page or filter it. **The Shopify admin already ships a
dark palette — it just has no switch.** This flips Shopify's own, so the
colours are the ones their design team picked.

```
Toggle → top bar, left of Sidekick.  Remembered across sessions. No flash on load.
```

## Install

Chrome / Edge / Brave:

1. Download `shopify-admin-dark-mode.zip` from
   [the latest release](https://github.com/pillgat3s/shopify-admin-dark-mode/releases/latest)
   and unzip it
2. Open `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. **Load unpacked** → select the unzipped folder
5. Open your Shopify admin — the moon icon is in the top bar

Firefox: `about:debugging` → **This Firefox** → **Load Temporary Add-on** →
pick `manifest.json`. Firefox unloads temporary add-ons when it closes.

It is not on the Chrome Web Store, so there is no auto-update. New versions
are published as releases here; the extension's toolbar popup links back to
this page.

## Surfaces

| | |
|---|---|
| Shopify admin | `admin.shopify.com` |
| Partners dashboard | `partners.shopify.com` |
| Embedded apps | Shopify's own, plus any you add |

## Three design systems, one decision

Partners turned out to be three different apps on one domain, which is what
forced the extension's shape:

- the **org picker** is current Polaris and ships `.p-theme-dark-experimental`
- the **dashboard** is Polaris v11 — old token naming (`--p-color-bg-subdued`),
  and no dark rule anywhere in its CSS
- **settings** and **themes** are Shopify's legacy `ui-*` system, with zero
  `--p-*` properties at all

So the extension does not decide by URL or by product. On every page it asks
what is actually there, in order:

1. **Does a dark palette ship?** Flip it. The admin and the org picker take
   this path, and get colours Shopify's own designers picked.
2. **Are there tokens but no dark palette?** Derive one — remap the tokens
   themselves so components theme themselves off the new values, which
   reaches hover and focus states no element pass would ever render.
3. **Neither?** Repaint element by element, the same pass third-party apps
   get.

Steps 2 and 3 compose rather than compete: the element pass reads computed
colour, so anything the tokens already darkened measures as dark and is
skipped.

## How it works

Two mechanisms, both Shopify's own:

- **`.p-partial-theme-dark-experimental` on `<html>`** redefines 214 of the
  admin's 255 Polaris `--p-color-*` tokens with Shopify's dark values. CSS
  custom properties inherit through shadow boundaries, so this one class
  reaches inside every Polaris web component.
- **`<s-internal-theme-provider colorscheme="dark">`.** Most of the admin is
  `<s-*>` web components wrapped in these providers — 270 of them on the
  orders page. Shopify already sets a few to `dark`; that's why the top bar
  is black even in light mode. This flips the rest.

New admin surfaces get themed for free, as long as they read the tokens.

### The contrast guard

Some components hardcode a light colour instead of reading a token.
`s-metrics-bar` paints its `.card` pure white inside its shadow root, so the
summary strip on Orders stayed white while its text went light grey —
unreadable.

There's no list of these to hardcode: the light-DOM class names are
CSS-module hashed (`_Container_1f6ay_1`) and change on every Shopify deploy.
So instead of guessing, the guard measures. It walks the document and every
open shadow root, computes the WCAG contrast ratio of each text element
against its own background, and for any pair below **1.6** fixes the stale
half — darkening the background if the surface never migrated, or lightening
the text if it's dark-on-dark.

It only ever acts on a pair that is *already* unreadable, so it cannot bury
something that was legible.

The same pass fixes three light-mode assumptions no contrast measurement
would catch:

- **`mix-blend-mode: multiply`** (and `darken`, `color-burn`) is neutralised.
  Shopify composites the home page card illustrations with multiply so the
  artwork's white background dissolves into the white card. Multiply against
  white is a no-op; against a black card it crushes the illustration to a
  dark smudge.
- **Light neutral gradients are remapped.** The home page fades its metrics
  strip with `linear-gradient(rgba(251,251,251,.98), transparent)` — a white
  scrim for a white page. The stops are rewritten in place, so shape,
  direction and the alpha ramp survive and only the colour changes.
- **Light canvases are inverted.** Canvas pixels are drawn by JS and no CSS
  can recolour them, so the visitor globe stayed a glaring white sphere. The
  canvas is sampled first and only inverted if it really is light; the hue
  rotation keeps the green live-visitor markers green.

Three details that took a while to get right, all documented at the code:

- **Backgrounds resolve through the flattened tree, not the DOM tree.** Metric
  cards are *slotted* into a shadow-side wrapper, so walking `parentElement`
  sails past the white card and lands on `<html>` — which is painted dark. The
  measurement then says "great contrast" while the text is invisible.
  Following `assignedSlot` first fixes it.
- **The guard re-runs after it changes anything.** Fixing a background changes
  the verdict for text drawn on it, and `adoptedStyleSheets` edits don't fire
  mutation records, so nothing else would trigger the re-measure.
- **Fixes land on the nearest *classed* ancestor,** and the walk stops before
  `<html>`. Text often sits in a bare unclassed wrapper; an element with no
  class has no selector to write a rule for. But `<html>` always carries the
  theme classes, so an unbounded walk lets one stray text node claim the
  `<html>` selector and starve every other unclassed element on the page.

## Embedded apps

An embedded app renders in a cross-origin iframe from the app developer's own
domain, so there's usually no Polaris palette to flip.

**Usually.** Shopify's own embedded apps (Messaging, Search & Discovery, Flow)
are Polaris apps in their own document, shipping the same tokens the admin
does. Each app frame checks at runtime whether Polaris tokens are present and
picks its path — flip the palette, or repaint the neutrals. The check is on
the tokens, not the origin, so third-party apps built on Polaris get the good
path too.

For everything else, light surfaces are darkened and dark text lightened
whether or not they're broken. Two things keep that from wrecking the app:

- **Only neutral colours are touched.** Whites and greys are structure and
  belong to the theme. Anything with real chroma is the app's identity — brand
  blues, illustrations, status badges, links — and is left alone.
- **Elevation is preserved, not inverted.** A white card on a grey page reads
  as raised because it's lighter. White maps to `#242424` and the page grey to
  `#212121`, so the card still sits above the page.

Expect repainted apps to look good but not native. Polaris apps should look
native.

### Theming your own apps

Covered out of the box: `*.shopifyapps.com` (Shopify's own — Inbox,
Messaging, Search & Discovery, Translate & Adapt, Flow, Shop, POS, Google,
Facebook) and `loox.io`.

Every other app serves from its own domain and has to be added by hand. Open
the app in your admin, and in the DevTools console run:

```js
[...document.querySelectorAll('iframe')].map(f => new URL(f.src).origin)
```

Add what it prints to **both** `host_permissions` and the second
`content_scripts` entry's `matches` in `manifest.json`, then reload the
extension.

Prefer exact hosts over wildcards. `https://*.up.railway.app/*` is shorter
than naming one app, but it grants access to every Railway-deployed site on
the internet. Only `*.shopifyapps.com` gets a wildcard here, because that
whole domain is Shopify's.

`content.js` checks `location.ancestorOrigins` and does nothing unless it is
a frame inside `admin.shopify.com` — so opening one of those domains directly
in a tab is untouched. Still, only add domains you want themed.

## Privacy

No analytics, no network requests, no data leaves the browser. The only
stored value is whether dark mode is on.

`storage` is used because an app frame is a different origin and can't read
the admin's `localStorage`. The admin also mirrors the setting into
`localStorage`, which is readable synchronously at `document_start` — that's
what makes the page paint dark on the first frame instead of flashing white.

## Known limits

- **One inference isn't backed by a measurement.** The home page globe is a
  WebGL2 canvas with `preserveDrawingBuffer: false`, so its drawing buffer is
  discarded once the frame composites — `drawImage` into a scratch canvas
  returns zero opaque pixels, and `readPixels` on the live context returns the
  same. The pixels are genuinely gone by the time an extension can look. So an
  *unreadable* canvas above 150px square is assumed to be light artwork and
  inverted. That holds because the admin ships no dark mode, meaning every
  canvas in it is drawn against a white page — but if Shopify ever draws one
  from dark tokens, this inverts it the wrong way.
- **Surfaces are only repainted when the element has its own class.** Colour
  inherits, so a text fix can be written against a classed ancestor; a
  background can't, since painting the ancestor colours a larger box.
- **A seeded selector can go stale.** `SEED_RULES` exists only so the metrics
  bar is dark on the frame it mounts rather than a beat later. If Shopify
  renames it the flash returns, but the guard still fixes it.
- Unofficial and unaffiliated with Shopify. It leans on an experimental class
  Shopify has not shipped a switch for; they could rename or remove it.

## Files

| File | |
|---|---|
| `manifest.json` | MV3 |
| `content.js` | theme switching, toggle button, contrast guard, app repaint |
| `theme.css` | pre-paint background, toggle styling, app-frame base |
| `popup.html/.css/.js` | toolbar popup — links back here |

## License

MIT
