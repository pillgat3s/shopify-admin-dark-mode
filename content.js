/* Shopify Admin Dark Mode
 *
 * How this works
 * --------------
 * The Shopify admin already ships a dark theme -- it just has no switch.
 *
 *   1. `.p-partial-theme-dark-experimental` on <html> redefines 214 of the
 *      admin's 255 Polaris `--p-color-*` tokens with Shopify's own dark
 *      values. Custom properties inherit through shadow boundaries, so this
 *      one class reaches inside every Polaris web component.
 *
 *   2. Most of the admin UI is <s-*> web components wrapped in
 *      <s-internal-theme-provider colorscheme="light|dark">. Shopify already
 *      sets some to "dark" -- that is why the top bar is black in light mode.
 *      We flip the rest.
 *
 * Neither step is a hack: both are Shopify's own theming mechanism, so the
 * colours are the ones their design team picked, not ones invented here.
 *
 * The gap, and why `contrastGuard` exists
 * ---------------------------------------
 * A few components hardcode a light colour instead of reading a token --
 * `s-metrics-bar` paints `.card` pure white inside its shadow root, so the
 * summary strip on Orders stayed white while its text went light grey and
 * became unreadable. That is exactly the "content gets buried" failure this
 * extension must not ship, and there is no list of offenders to hardcode
 * (the light-DOM class names are hashed per deploy).
 *
 * So instead of guessing, `contrastGuard` measures: it finds text whose
 * contrast against its own background has collapsed and fixes that specific
 * pair. It only ever acts on a pair that is already unreadable, which means
 * a false positive is not possible in the direction that matters -- it
 * cannot bury something that was legible.
 */

(() => {
  'use strict';

  const STORAGE_KEY = 'sdm:enabled';
  const DARK_CLASS = 'sdm-dark';

  /* Shopify's own dark token class. The un-suffixed name is applied too: the
   * admin has begun emitting it and applying a class with no matching rule
   * is free, so carrying both survives the rename either way. */
  const POLARIS_DARK_CLASSES = [
    'p-partial-theme-dark-experimental',
    'p-partial-theme-dark',
  ];

  const PROVIDER = 's-internal-theme-provider';

  /* Marks the providers we switched, so turning dark mode off restores those
   * and leaves Shopify's natively-dark ones (the top bar) alone. */
  const TOUCHED = 'sdmWasLight';

  const root = document.documentElement;

  /* --- frame role --------------------------------------------------------
   *
   * This script runs in two very different places: the admin itself, and the
   * cross-origin iframe an embedded app renders into.
   *
   * In the admin we flip Shopify's own theme. Inside a third-party app we
   * cannot -- it is someone else's site with its own design system -- so we
   * repaint its neutral colours instead.
   *
   * But not every app is third-party. Shopify's own embedded apps (Messaging,
   * Search & Discovery, Flow...) are Polaris apps in their own document, and
   * they ship the very same `--p-color-*` tokens the admin does. Repainting
   * those by hand produced a half-themed mess, because a Polaris app is not
   * a pile of neutral greys to remap -- it is a themed app whose theme we can
   * simply flip, exactly like the admin. `detectPolaris` picks that up at
   * runtime rather than by matching on the origin, so an app is treated as
   * Polaris because it *is* one, not because of who hosts it.
   *
   * The gate matters for more than tidiness: the manifest has to list each
   * app's own domain to reach its iframe, and this makes sure that access is
   * never used on those domains outside the admin. Open loox.io directly in
   * a tab and this script does nothing at all. */
  const IS_TOP_FRAME = window === window.top;
  const ADMIN_ORIGIN = 'https://admin.shopify.com';

  function embeddedInAdmin() {
    try {
      const ancestors = location.ancestorOrigins;
      if (ancestors && ancestors.length) {
        return ancestors[ancestors.length - 1] === ADMIN_ORIGIN;
      }
    } catch (e) {
      /* Firefox has no ancestorOrigins; fall through to the referrer. */
    }

    return document.referrer.startsWith(ADMIN_ORIGIN + '/');
  }

  const IS_APP_FRAME = !IS_TOP_FRAME && embeddedInAdmin();
  if (!IS_TOP_FRAME && !IS_APP_FRAME) return;

  /* Whether this app frame turns out to be a Polaris app. Unknowable at
   * document_start -- no stylesheet has loaded yet -- so it is resolved once
   * the document is ready and the theming path is chosen then. */
  let isPolarisFrame = false;

  function detectPolaris() {
    const tokens = getComputedStyle(root);
    return !!(
      tokens.getPropertyValue('--p-color-bg').trim() ||
      tokens.getPropertyValue('--p-color-bg-surface').trim() ||
      document.querySelector(PROVIDER)
    );
  }

  /* Flip Shopify's palette (admin, and Shopify's own apps) versus remap
   * someone else's neutrals (everything third-party). */
  const usesPolarisTheme = () => IS_TOP_FRAME || isPolarisFrame;
  const usesGenericRepaint = () => IS_APP_FRAME && !isPolarisFrame;

  /* --- preference --------------------------------------------------------
   *
   * `chrome.storage` is the real store because an app frame is a different
   * origin and cannot see the admin's localStorage. But it is async, and a
   * value that arrives a frame late is exactly the white flash this whole
   * extension exists to avoid -- so the admin also mirrors the setting into
   * localStorage, which is readable synchronously at document_start.
   *
   * App frames just take the async read; a brief flash inside one app pane
   * is not worth complicating the top-frame path for. */
  let enabled = IS_TOP_FRAME && readMirror();

  function readMirror() {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function writePreference(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
    } catch (e) {
      /* Blocked storage: the toggle still works this session. */
    }

    try {
      chrome.storage.local.set({ enabled: value });
    } catch (e) {
      /* Extension context torn down (usually a reload during development). */
    }
  }

  function watchPreference() {
    try {
      chrome.storage.local.get('enabled', (stored) => {
        if (chrome.runtime.lastError) return;

        if (typeof stored.enabled !== 'boolean') {
          /* Nothing stored yet. The admin seeds it from its own localStorage
           * mirror, because otherwise a session that never touches the toggle
           * leaves app frames with no way to learn dark mode is on -- they
           * are a different origin and cannot read the mirror. That is a
           * whole session of apps silently staying light. */
          if (IS_TOP_FRAME) chrome.storage.local.set({ enabled });
          return;
        }

        if (stored.enabled !== enabled) setEnabled(stored.enabled);
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.enabled) return;
        if (changes.enabled.newValue !== enabled) {
          setEnabled(!!changes.enabled.newValue);
        }
      });
    } catch (e) {
      /* No extension context: the top frame still works off its mirror. */
    }
  }

  /* --- theme application ------------------------------------------------- */

  function applyRootClasses() {
    root.classList.toggle(DARK_CLASS, enabled);

    /* A dark page base for any app frame, applied at document_start before we
     * know which kind it is. Harmless either way -- it only paints the
     * canvas, and a Polaris frame paints over it a moment later. */
    if (IS_APP_FRAME) root.classList.toggle('sdm-app', enabled);

    /* The forced ink colour is only right for a frame we are repainting by
     * hand. Forcing it on a Polaris app would fight its own tokens. */
    if (IS_APP_FRAME) {
      root.classList.toggle('sdm-app-ink', enabled && usesGenericRepaint());
    }

    if (usesPolarisTheme()) {
      POLARIS_DARK_CLASSES.forEach((cls) =>
        root.classList.toggle(cls, enabled)
      );
    }
  }

  /* Theme providers emit nested `.p-theme-light` containers, and that class
   * re-declares the *full* light token set -- so any such subtree would
   * re-lighten itself from the inside. */
  function applyNestedLightScopes() {
    for (const element of document.querySelectorAll('.p-theme-light')) {
      if (element === root) continue;
      POLARIS_DARK_CLASSES.forEach((cls) =>
        element.classList.toggle(cls, enabled)
      );
    }
  }

  /* Takes an explicit list so the hot path can pass a cheap light-DOM query
   * while the throttled deep scan passes what it finds inside shadow roots. */
  function applyProviders(providers) {
    for (const provider of providers) {
      if (enabled) {
        if (provider.getAttribute('colorscheme') === 'light') {
          provider.dataset[TOUCHED] = '1';
          provider.setAttribute('colorscheme', 'dark');
        }
      } else if (provider.dataset[TOUCHED]) {
        provider.setAttribute('colorscheme', 'light');
        delete provider.dataset[TOUCHED];
      }
    }
  }

  /* --- shadow DOM traversal ---------------------------------------------- */

  /* Every shadow root in the admin is `mode: "open"`, so we can both read and
   * style component internals. */
  function walkRoots(visit) {
    const stack = [document];

    while (stack.length) {
      const current = stack.pop();
      observeRoot(current);
      visit(current);

      for (const element of current.querySelectorAll('*')) {
        if (element.shadowRoot) stack.push(element.shadowRoot);
      }
    }
  }

  /* Mutations inside a shadow root do not bubble out to an observer on
   * <body>, so a component that re-renders itself after the theme changes
   * would otherwise be invisible to us. Observing each root directly is what
   * makes the guard react to those re-renders. */
  const observedRoots = new WeakSet();

  function observeRoot(node) {
    if (node === document || observedRoots.has(node)) return;

    observedRoots.add(node);
    observer.observe(node, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['colorscheme', 'class'],
    });
  }

  function deepQuery(selector) {
    const results = [];
    walkRoots((r) => results.push(...r.querySelectorAll(selector)));
    return results;
  }

  function lightDomProviders() {
    return document.querySelectorAll(PROVIDER);
  }

  /* --- colour maths ------------------------------------------------------ */

  function parseColor(value) {
    const match = /^rgba?\(([^)]+)\)$/.exec(value);
    if (!match) return null;

    const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
    if (parts.length < 3 || parts.some(Number.isNaN)) return null;

    return {
      r: parts[0],
      g: parts[1],
      b: parts[2],
      a: parts.length > 3 ? parts[3] : 1,
    };
  }

  function relativeLuminance({ r, g, b }) {
    const channel = (value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }

  function contrastRatio(a, b) {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
  }

  /* Walks the *flattened* tree, not the DOM tree.
   *
   * This distinction is the whole ballgame for the metrics bar. Each metric
   * card is a light-DOM child of <s-metrics-bar> that gets slotted into a
   * `.card` wrapper inside that component's shadow root. Following
   * `parentElement` walks straight past `.card` -- every ancestor reports a
   * transparent background and the search runs all the way up to <html>,
   * which we painted dark, so the text looks perfectly readable and the
   * guard finds nothing. Following `assignedSlot` first goes through the
   * slot into the shadow side, where the white background actually lives. */
  function flattenedParent(node) {
    return node.assignedSlot || node.parentElement || node.getRootNode().host ||
      null;
  }

  /* The element's own background is almost always transparent, so walk up
   * until something actually paints. */
  function effectiveBackground(element) {
    let node = element;

    while (node) {
      const color = parseColor(getComputedStyle(node).backgroundColor);
      if (color && color.a > 0.5) return { color, owner: node };

      node = flattenedParent(node);
    }

    return null;
  }

  /* --- contrast guard ---------------------------------------------------- */

  /* Below this ratio text is not "low contrast", it is invisible. WCAG's
   * floor for body text is 4.5; staying near 1 means we only ever touch
   * genuinely buried content and never second-guess Shopify's design. */
  const CONTRAST_FLOOR = 1.6;

  /* One pass is capped so a 500-row order list can never cause a long frame.
   * Anything skipped is picked up on the next pass. */
  const SCAN_BUDGET = 3000;

  /* Style keyed by scope: one <style> for the document, one CSSStyleSheet per
   * component tag shared by every instance of that component. */
  const documentRules = new Map();
  const shadowSheets = new Map();
  const shadowRules = new Map();

  /* Selectors already judged, per scope, so repeat renders cost a Set lookup
   * instead of a getComputedStyle call. This is what keeps the steady state
   * cheap.
   *
   * It is keyed by scope rather than being one flat set because the verdict
   * is only valid for the colours the element had when we measured it. Web
   * components re-render asynchronously after `colorscheme` flips, so a
   * component measured before its re-render was judged in its *old* colours.
   * Dropping a scope's verdicts whenever that scope mutates is what forces
   * the re-measure. */
  const judged = new Map();

  function judgedSet(scopeKey) {
    const key = scopeKey || '';
    let set = judged.get(key);
    if (!set) judged.set(key, (set = new Set()));
    return set;
  }

  function forgetScope(node) {
    judged.delete(scopeKeyFor(node.getRootNode()) || '');
  }

  let documentStyle = null;

  function documentStyleElement() {
    if (documentStyle && documentStyle.isConnected) return documentStyle;

    documentStyle = document.createElement('style');
    documentStyle.id = 'sdm-contrast-guard';
    (document.head || root).appendChild(documentStyle);
    return documentStyle;
  }

  /* A selector for the element, scoped to where the rule will live.
   *
   * Inside a shadow root the class names are the component's own and are NOT
   * hashed (`.card`, `.arrows-wrapper`), so they are stable across deploys.
   * In the light DOM they are CSS-module hashed (`_Container_1f6ay_1`) and
   * change every deploy -- which is exactly why nothing here is hardcoded and
   * the selectors are discovered at runtime instead. */
  function selectorFor(element) {
    const classes = element.classList ? Array.from(element.classList) : [];
    if (!classes.length) return null;
    return classes.map((cls) => '.' + CSS.escape(cls)).join('');
  }

  /* The element we can actually write a rule for.
   *
   * Text often sits in an unclassed wrapper -- the settings nav renders the
   * active item as `<a class="_Link _Active"><div><span class="_Label"><span>
   * General`, and only that innermost bare <span> holds the text node. With
   * no class there is no selector, so the guard used to skip it and the
   * active item stayed invisible dark-on-dark.
   *
   * Colour inherits, so styling the nearest classed ancestor fixes the text
   * just as well. The walk stops at the shadow boundary because a rule can
   * only live in one root's stylesheet. */
  const TARGET_MAX_HOPS = 4;

  function styleTargetFor(element) {
    const ownRoot = element.getRootNode();
    let node = element;

    for (let hop = 0; node && hop <= TARGET_MAX_HOPS; hop++) {
      if (node.getRootNode() !== ownRoot) return null;

      /* Never retarget onto the page itself. <html> always carries our own
       * theme classes, so an unclassed element would otherwise "find" a
       * selector there -- and then a single stray text node would claim the
       * <html> selector in the seen-set and every other unclassed element on
       * the page would be skipped for the rest of the pass. */
      if (node === root || node === document.body) return null;
      if (selectorFor(node)) return node;

      node = node.parentElement;
    }

    return null;
  }

  function scopeKeyFor(node) {
    return node === document ? null : node.host.tagName.toLowerCase();
  }

  /* Rules are stored per selector *per property*, not as one declaration
   * string. An app-frame card routinely needs a background, a border and a
   * text colour, and keying only by selector meant each fix silently
   * clobbered the one before it. */
  function addRule(scopeKey, selector, property, value) {
    const store = scopeKey === null ? documentRules : shadowRules;
    const bucket = scopeKey === null
      ? store
      : store.get(scopeKey) || store.set(scopeKey, new Map()).get(scopeKey);

    const declarations = bucket.get(selector) ||
      bucket.set(selector, new Map()).get(selector);

    if (declarations.get(property) === value) return false;

    declarations.set(property, value);
    return true;
  }

  function serialize(declarations) {
    return Array.from(declarations, ([property, value]) =>
      `${property}: ${value} !important;`
    ).join(' ');
  }

  function flushRules(scopeKey) {
    if (scopeKey === null) {
      const text = Array.from(documentRules, ([selector, declarations]) =>
        `html.${DARK_CLASS} ${selector} { ${serialize(declarations)} }`
      ).join('\n');

      documentStyleElement().textContent = text;
      return;
    }

    const bucket = shadowRules.get(scopeKey);
    if (!bucket) return;

    shadowSheets.get(scopeKey).replaceSync(
      Array.from(bucket, ([selector, declarations]) =>
        `${selector} { ${serialize(declarations)} }`
      ).join('\n')
    );
  }

  function sheetFor(scopeKey, shadowRoot) {
    let sheet = shadowSheets.get(scopeKey);

    if (!sheet) {
      sheet = new CSSStyleSheet();
      shadowSheets.set(scopeKey, sheet);
    }

    if (!shadowRoot.adoptedStyleSheets.includes(sheet)) {
      shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, sheet];
    }

    return sheet;
  }

  function hasOwnText(element) {
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()) return true;
    }
    return false;
  }

  /* Offenders the guard reliably finds on its own, pre-registered so they are
   * fixed on the frame the component mounts instead of after a measure pass.
   *
   * Without this the metrics bar on Products and Orders flashes white for
   * about half a second on every navigation: the guard cannot judge a
   * component before it renders, and the throttle adds another beat. These
   * are shadow-root class names, which -- unlike the hashed light-DOM ones --
   * are the component's own and stable across deploys.
   *
   * This is an optimisation, not the mechanism. If Shopify renames these the
   * flash comes back, but the guard still fixes them a beat later. */
  const SURFACE = 'var(--p-color-bg-surface, #1a1a1a)';

  const SEED_RULES = {
    's-metrics-bar': {
      '.card': ['background-color', SURFACE],
      '.arrows-wrapper': ['background-color', SURFACE],
    },
  };

  function applySeeds() {
    for (const [tag, rules] of Object.entries(SEED_RULES)) {
      for (const host of document.querySelectorAll(tag)) {
        if (!host.shadowRoot) continue;

        let changed = false;
        for (const [selector, [property, value]] of Object.entries(rules)) {
          if (addRule(tag, selector, property, value)) changed = true;
        }

        const sheet = shadowSheets.get(tag);
        const adopted = sheet && host.shadowRoot.adoptedStyleSheets.includes(sheet);

        if (changed || !adopted) {
          sheetFor(tag, host.shadowRoot);
          flushRules(tag);
        }
      }
    }
  }

  /* Blend modes that assume a light backdrop.
   *
   * Shopify composites the home page card illustrations with
   * `mix-blend-mode: multiply` so the artwork's white background dissolves
   * into the white card. Multiply against white is a no-op; against a black
   * card it multiplies everything toward black and the illustration turns
   * into a dark smudge. `screen`/`lighten` assume the opposite and are
   * already correct on a dark backdrop, so they are left alone. */
  const LIGHT_BACKDROP_BLENDS = new Set(['multiply', 'darken', 'color-burn']);

  /* Gradients are the other place a light-mode assumption hides, and no
   * contrast measurement can see it -- the guard only ever reads
   * `background-color`, and a gradient lives in `background-image`.
   *
   * The home page fades its metrics strip out with
   * `linear-gradient(rgba(251,251,251,.98), transparent)`, a white scrim for
   * fading content into a white page. On a dark page it is just a pale bar
   * across the top with the labels washed out underneath it.
   *
   * Rewriting the stops keeps the gradient's shape, direction and alpha ramp
   * intact and only swaps the colour -- and only for light *neutral* stops,
   * so a brand-coloured gradient is left alone exactly like a brand-coloured
   * surface. */
  function remapNeutralGradient(image) {
    let changed = false;

    const next = image.replace(/rgba?\([^)]*\)/g, (match) => {
      const color = parseColor(match);
      if (!color) return match;

      /* Fully transparent stops carry no colour to fix; rewriting them would
       * turn an invisible endpoint into a visible one. */
      if (color.a < 0.05) return match;
      if (chroma(color) > NEUTRAL_CHROMA) return match;
      if (relativeLuminance(color) <= 0.5) return match;

      changed = true;
      const [r, g, b] = darkenSurface(color).match(/\d+/g);
      return color.a >= 0.999
        ? `rgb(${r}, ${g}, ${b})`
        : `rgba(${r}, ${g}, ${b}, ${color.a})`;
    });

    return changed ? next : null;
  }

  /* Canvas pixels are drawn by JS and no CSS can recolour them, so a canvas
   * that Shopify painted for a light page (the home page visitor globe: a
   * pale sphere meant to sit on white) stays glaring. Inverting is the only
   * lever available; the hue rotation puts colours back where they were, so
   * the green live-visitor markers stay green.
   *
   * This is the one heuristic here that infers rather than measures a broken
   * pair, so it is gated on the canvas actually being predominantly light --
   * a chart already drawn from dark tokens measures dark and is left alone. */
  /* --- app-frame repaint --------------------------------------------------
   *
   * Inside an embedded app the contrast guard alone is not enough. A Loox
   * card is white with dark text on it -- perfectly readable, so the guard
   * refuses to touch it, and correctly so. The page ends up dark around big
   * white islands.
   *
   * So app frames get an active remap rather than a repair: light surfaces
   * are darkened and dark text is lightened, whether or not they are broken.
   *
   * The thing that keeps this from wrecking the app is that it only touches
   * *neutral* colours. Whites and greys are structure -- cards, dividers,
   * page chrome -- and belong to the theme. Anything with real chroma is the
   * app's identity: brand blues, the purple illustration, the green and pink
   * badges, status colours. Those are left exactly as they are.
   *
   * Elevation is preserved rather than inverted. In light mode a white card
   * sits on a grey page: lighter means raised. Dark mode keeps that reading,
   * so a lighter source grey maps to a lighter dark grey, and the card still
   * reads as sitting above the page. */

  /* Distance from grey. Pure white and every grey score 0; a brand blue
   * scores well above the threshold. Deliberately loose so tinted surfaces
   * like a pale blue notice banner keep their colour. */
  function chroma({ r, g, b }) {
    return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  }

  const NEUTRAL_CHROMA = 0.1;

  function isNeutral(color) {
    return color.a > 0.5 && chroma(color) <= NEUTRAL_CHROMA;
  }

  function isLightNeutral(color) {
    return isNeutral(color) && relativeLuminance(color) > 0.5;
  }

  function isDarkNeutral(color) {
    return isNeutral(color) && relativeLuminance(color) < 0.5;
  }

  const clamp01 = (n) => Math.min(1, Math.max(0, n));

  /* Light neutral -> dark neutral, keeping the brighter source brighter. */
  function darkenSurface(color) {
    const level = Math.round(
      18 + clamp01((relativeLuminance(color) - 0.5) / 0.5) * 18
    );
    return `rgb(${level}, ${level}, ${level})`;
  }

  /* Dark neutral ink -> light ink, keeping muted greys muted.
   *
   * Driven by plain channel average rather than relative luminance. The
   * luminance curve is steep near black, so body ink and muted grey -- 0.01
   * and 0.16 -- come out barely a shade apart, and every secondary label in
   * the app gets promoted to full-strength white. The linear measure keeps
   * the hierarchy the app's designer intended. */
  function perceivedLightness({ r, g, b }) {
    return (r + g + b) / 765;
  }

  function lightenInk(color) {
    const level = Math.round(
      235 - clamp01(perceivedLightness(color) / 0.5) * 90
    );
    return `rgb(${level}, ${level}, ${level})`;
  }

  /* Hairline borders read as harsh bright lines once inverted, so they get a
   * translucent white instead of a solid grey. */
  const DARK_BORDER = 'rgba(255, 255, 255, 0.14)';

  function hasVisibleBorder(style) {
    return parseFloat(style.borderTopWidth) > 0 ||
      parseFloat(style.borderBottomWidth) > 0 ||
      parseFloat(style.borderLeftWidth) > 0 ||
      parseFloat(style.borderRightWidth) > 0;
  }

  const CANVAS_SAMPLE = 12;
  const CANVAS_LIGHT_THRESHOLD = 0.55;

  function canvasLightness(canvas) {
    try {
      const off = document.createElement('canvas');
      off.width = CANVAS_SAMPLE;
      off.height = CANVAS_SAMPLE;

      const ctx = off.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, 0, CANVAS_SAMPLE, CANVAS_SAMPLE);

      const { data } = ctx.getImageData(0, 0, CANVAS_SAMPLE, CANVAS_SAMPLE);
      let total = 0;
      let counted = 0;

      for (let i = 0; i < data.length; i += 4) {
        /* Transparent pixels are the page showing through, not the canvas. */
        if (data[i + 3] < 128) continue;
        total += relativeLuminance({ r: data[i], g: data[i + 1], b: data[i + 2] });
        counted++;
      }

      /* Nothing drawn yet -- report unknown so the verdict is not cached. */
      if (!counted) return null;
      return total / counted;
    } catch (e) {
      return null;
    }
  }

  /* Some canvases cannot be read at all, and the home page globe is one:
   * it is WebGL2 with `preserveDrawingBuffer: false`, so the drawing buffer
   * is discarded once the frame is composited. `drawImage` into a scratch
   * canvas yields zero opaque pixels, and `readPixels` on the live context
   * yields the same. Both were measured on the real page -- this is not a
   * fixable sampling bug, the pixels are genuinely gone by the time any
   * extension can look.
   *
   * Left unjudged, the globe stays a glaring white sphere -- easily the
   * brightest thing on an otherwise dark page.
   *
   * So an unreadable canvas of real size is assumed to be light. That holds
   * because the admin ships no dark mode: every canvas in it is authored
   * against a white page. It is the one inference in this file not backed by
   * a measurement, and it has a clear expiry -- if Shopify ever draws a
   * canvas from dark tokens, this would invert it the wrong way. The size
   * gate keeps it away from small sparklines and spacers. */
  const CANVAS_ASSUME_LIGHT_MIN_PX = 150;

  function canvasLooksLikeLightArtwork(canvas) {
    const rect = canvas.getBoundingClientRect();
    return rect.width >= CANVAS_ASSUME_LIGHT_MIN_PX &&
      rect.height >= CANVAS_ASSUME_LIGHT_MIN_PX;
  }

  /* Remaps one element's neutral colours. Only for third-party app frames. */
  function repaintAppElement(
    element, style, target, selector, carriesText, write, scopeKey, currentRoot
  ) {
    /* Colour inherits, so a text fix can safely be written against a classed
     * ancestor. A background cannot: painting the ancestor would colour a
     * different, usually much larger box. So surfaces are only repainted
     * when the element carries its own class to select. Unclassed wrappers
     * are nearly always transparent anyway -- app frameworks put backgrounds
     * on the component, not on the div holding it. */
    const canPaintBox = target === element;

    const own = parseColor(style.backgroundColor);

    /* Images carry their own baked-in backgrounds; recolouring the box
     * behind them does nothing good. */
    const paintsImage = style.backgroundImage !== 'none';

    if (canPaintBox && own && isLightNeutral(own) && !paintsImage) {
      write(scopeKey, currentRoot, selector,
        'background-color', darkenSurface(own));
    }

    if (canPaintBox && hasVisibleBorder(style)) {
      const border = parseColor(style.borderTopColor);
      if (border && isLightNeutral(border)) {
        write(scopeKey, currentRoot, selector, 'border-color', DARK_BORDER);
      }
    }

    if (!carriesText) return;

    const ink = parseColor(style.color);
    if (!ink || !isDarkNeutral(ink)) return;

    /* Only lighten text that will actually end up on a dark surface. Text on
     * a chromatic panel we deliberately left alone -- a coloured notice
     * banner, a brand-filled button -- must keep its dark ink or we would be
     * the ones burying it. */
    const background = effectiveBackground(element);
    if (!background) return;

    const willBeDark = isLightNeutral(background.color) ||
      relativeLuminance(background.color) < 0.5;
    if (!willBeDark) return;

    write(scopeKey, currentRoot, selector, 'color', lightenInk(ink));
  }

  function contrastGuard() {
    if (!enabled) return;

    let scanned = 0;
    const dirtyScopes = new Set();

    walkRoots((currentRoot) => {
      const scopeKey = scopeKeyFor(currentRoot);

      /* This is the only pass that reaches inside shadow roots, so it is also
       * where providers nested in one get flipped. */
      if (scopeKey !== null) {
        applyProviders(currentRoot.querySelectorAll(PROVIDER));
      }

      const seen = judgedSet(scopeKey);

      const write = (targetScope, targetRoot, selector, property, value) => {
        if (targetScope !== null) sheetFor(targetScope, targetRoot);
        if (addRule(targetScope, selector, property, value)) {
          dirtyScopes.add(targetScope);
        }
      };

      for (const element of currentRoot.querySelectorAll('*')) {
        if (scanned >= SCAN_BUDGET) return;

        const isCanvas = element.tagName === 'CANVAS';
        const carriesText = hasOwnText(element);

        /* Every element with a class is a candidate. It used to be only text
         * and canvases, as an optimisation -- but a light gradient scrim
         * carries no text of its own and was invisible to the pass because of
         * it. The seen-set already makes the steady state cheap, so the
         * filter was buying very little and hiding real bugs. */

        /* Fixes land on the nearest classed ancestor when the element itself
         * has no class to select. */
        const target = styleTargetFor(element);
        if (!target) continue;

        const selector = selectorFor(target);
        if (seen.has(selector)) continue;

        seen.add(selector);
        scanned++;

        const style = getComputedStyle(element);
        if (style.visibility === 'hidden' || style.display === 'none') {
          /* Not measurable yet -- let a later pass judge it. */
          seen.delete(selector);
          continue;
        }

        if (isCanvas) {
          const lightness = canvasLightness(element);
          const isLight = lightness === null
            ? canvasLooksLikeLightArtwork(element)
            : lightness > CANVAS_LIGHT_THRESHOLD;

          if (isLight) {
            write(scopeKey, currentRoot, selector,
              'filter', 'invert(1) hue-rotate(180deg)');
          } else if (lightness === null) {
            /* Too small to judge, and unreadable -- it may simply not have
             * been drawn yet, so do not cache the verdict. */
            seen.delete(selector);
          }
          continue;
        }

        /* A light-backdrop blend mode is broken by definition on a dark
         * page, independent of any contrast measurement. */
        if (LIGHT_BACKDROP_BLENDS.has(style.mixBlendMode)) {
          write(scopeKey, currentRoot, selector, 'mix-blend-mode', 'normal');
        }

        if (style.backgroundImage.includes('gradient')) {
          const remapped = remapNeutralGradient(style.backgroundImage);
          if (remapped) {
            write(scopeKey, currentRoot, selector, 'background-image', remapped);
          }
        }

        if (usesGenericRepaint()) {
          repaintAppElement(element, style, target, selector, carriesText,
            write, scopeKey, currentRoot);
          /* The contrast guard still runs below as a backstop for whatever
           * the repaint could not reach -- inline styles, chromatic
           * surfaces, anything painted by the app after this pass. */
        }

        const foreground = parseColor(style.color);
        if (!foreground || foreground.a < 0.5) continue;

        const background = effectiveBackground(element);
        if (!background) continue;

        if (contrastRatio(foreground, background.color) >= CONTRAST_FLOOR) {
          continue;
        }

        /* The pair is unreadable. Which half is stale? */
        if (relativeLuminance(background.color) > 0.5) {
          /* A light surface that never got the dark treatment (the white
           * `.card` in s-metrics-bar). Darken the element that paints it. */
          const owner = styleTargetFor(background.owner);
          if (!owner) continue;

          const ownerRoot = owner.getRootNode();
          write(scopeKeyFor(ownerRoot), ownerRoot, selectorFor(owner),
            'background-color', SURFACE);
        } else {
          /* Dark on dark: the text colour is the stale half. */
          write(scopeKey, currentRoot, selector,
            'color', 'var(--p-color-text, #eee)');
        }
      }
    });

    if (!dirtyScopes.size) return;

    dirtyScopes.forEach(flushRules);

    /* Fixing a background changes the verdict for everything drawn on it --
     * the metric card's value is dark text that only becomes buried once the
     * white card behind it goes dark. Adopted stylesheet changes do not fire
     * mutation records, so nothing else would trigger the re-measure.
     *
     * This terminates: a pass only re-arms itself when it added a rule, and
     * `addRule` refuses duplicates. */
    judged.clear();
    scheduleGuard();
  }

  function clearGuard() {
    documentRules.clear();
    shadowRules.clear();
    judged.clear();

    if (documentStyle) documentStyle.textContent = '';
    shadowSheets.forEach((sheet) => sheet.replaceSync(''));
  }

  /* --- toggle button ----------------------------------------------------- */

  const BUTTON_ID = 'sdm-toggle';

  /* `name="sidekickButton"` is the stable handle: aria-labels are translated
   * and the top-bar class names are hashed per deploy. */
  const ANCHORS = [
    'button[name="sidekickButton"]',
    'button[aria-controls="sidekick"]',
    'button[aria-label^="Alerts Feed"]',
  ];

  const MOON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.5 2.6a.75.75 0 0 0-.9-.98 8 8 0 1 0 9.78 9.78.75.75 0 0 0-.98-.9A6.5 6.5 0 0 1 8.5 2.6Z"/></svg>';

  const SUN = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="4.2"/><path d="M10 1.2a.7.7 0 0 1 .7.7v1.4a.7.7 0 0 1-1.4 0V1.9a.7.7 0 0 1 .7-.7Zm0 14a.7.7 0 0 1 .7.7v1.4a.7.7 0 0 1-1.4 0v-1.4a.7.7 0 0 1 .7-.7Zm8.8-5.2a.7.7 0 0 1-.7.7h-1.4a.7.7 0 0 1 0-1.4h1.4a.7.7 0 0 1 .7.7Zm-14 0a.7.7 0 0 1-.7.7H2.7a.7.7 0 0 1 0-1.4h1.4a.7.7 0 0 1 .7.7Zm11.4-6.2a.7.7 0 0 1 0 1L15.2 5.8a.7.7 0 1 1-1-1l1-1a.7.7 0 0 1 1 0ZM5.8 14.2a.7.7 0 0 1 0 1l-1 1a.7.7 0 1 1-1-1l1-1a.7.7 0 0 1 1 0Zm10.4 2a.7.7 0 0 1-1 0l-1-1a.7.7 0 1 1 1-1l1 1a.7.7 0 0 1 0 1ZM5.8 5.8a.7.7 0 0 1-1 0l-1-1a.7.7 0 0 1 1-1l1 1a.7.7 0 0 1 0 1Z"/></svg>';

  function buildButton(anchor) {
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';

    /* Reuse the neighbouring top-bar button's classes so we inherit
     * Shopify's exact sizing, hover and focus-ring styling for free. If those
     * class names ever change shape, fall back to our own styling rather than
     * rendering an unstyled button. */
    const inherited = Array.from(anchor.classList).filter((cls) =>
      cls.startsWith('_TopBarButton_')
    );

    button.className = inherited.length
      ? `${inherited.join(' ')} sdm-toggle`
      : 'sdm-toggle sdm-toggle--unstyled';

    button.addEventListener('click', () => setEnabled(!enabled));
    return button;
  }

  function paintButton(button) {
    const state = enabled ? 'on' : 'off';

    /* Repaint only on a real state change. `ensureButton` runs on every
     * mutation batch, and the admin mutates constantly -- reassigning
     * innerHTML each time swaps the <svg> out from under the pointer, so a
     * mousedown and mouseup could land on different nodes and the browser
     * would never fire the click. That made the toggle intermittently dead. */
    if (button.dataset.sdmState === state) return;
    button.dataset.sdmState = state;

    button.innerHTML = enabled ? SUN : MOON;
    button.setAttribute('aria-pressed', String(enabled));

    const label = enabled ? 'Switch to light mode' : 'Switch to dark mode';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  }

  function ensureButton() {
    const existing = document.getElementById(BUTTON_ID);
    if (existing && existing.isConnected) {
      paintButton(existing);
      return;
    }

    let anchor = null;
    for (const selector of ANCHORS) {
      anchor = document.querySelector(selector);
      if (anchor) break;
    }
    if (!anchor || !anchor.parentElement) return;

    const button = buildButton(anchor);
    paintButton(button);
    anchor.parentElement.insertBefore(button, anchor);
  }

  /* --- wiring ------------------------------------------------------------ */

  function setEnabled(value) {
    enabled = value;
    writePreference(value);

    applyRootClasses();

    if (usesPolarisTheme()) {
      applyNestedLightScopes();
      /* Deep query on the toggle itself: it is a one-off, and turning dark
       * mode off has to reach every provider we ever switched. */
      applyProviders(deepQuery(PROVIDER));
    }

    /* Every previous verdict was measured in the other theme. */
    judged.clear();

    if (enabled) contrastGuard();
    else clearGuard();

    ensureButton();
  }

  /* Cheap work runs on every batch; the deep contrast scan is throttled
   * separately because it is the only part that touches layout. */
  function refreshFast() {
    /* A third-party app has no providers to flip and no top bar to hang a
     * button on -- it only runs the repaint pass. */
    if (usesGenericRepaint()) return;

    applyNestedLightScopes();
    applyProviders(lightDomProviders());

    /* Only the admin has a metrics bar to seed and a top bar to inject into.
     * Shopify's embedded apps share the palette, not the chrome. */
    if (IS_TOP_FRAME) {
      /* Runs every frame rather than on the throttled guard, so a freshly
       * mounted metrics bar is dark on the frame it appears. */
      if (enabled) applySeeds();
      ensureButton();
    }
  }

  const GUARD_INTERVAL = 500;
  let lastGuardRun = 0;
  let guardTimer = 0;

  function scheduleGuard() {
    if (!enabled || guardTimer) return;

    const wait = Math.max(0, GUARD_INTERVAL - (Date.now() - lastGuardRun));
    guardTimer = setTimeout(() => {
      guardTimer = 0;
      lastGuardRun = Date.now();
      contrastGuard();
    }, wait);
  }

  /* The admin is a React Router SPA: routes re-render the page and mount new
   * theme providers, so a one-shot pass is not enough. Batching through rAF
   * keeps us to one pass per frame no matter how noisy a route change is. */
  let scheduled = false;

  function schedule() {
    if (scheduled) return;
    scheduled = true;

    requestAnimationFrame(() => {
      scheduled = false;
      refreshFast();
      scheduleGuard();
    });
  }

  const observer = new MutationObserver((records) => {
    /* A scope that changed has to be re-measured: its verdicts were recorded
     * against whatever colours it had before the change. */
    for (const record of records) forgetScope(record.target);
    schedule();
  });

  function start() {
    /* Stylesheets have loaded by now, so the Polaris tokens are finally
     * visible and the frame can pick its theming path. */
    if (IS_APP_FRAME && detectPolaris()) {
      isPolarisFrame = true;
      applyRootClasses();
    }

    refreshFast();
    if (enabled) contrastGuard();

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      /* `colorscheme` so we re-apply when Shopify's own code resets a
       * provider to light after a re-render; `class` so a route change that
       * strips our theme class from a container is undone. Because we only
       * ever act on the value "light", this converges instead of looping. */
      attributeFilter: ['colorscheme', 'class'],
    });
  }

  /* Runs at document_start: the class must go on before the first paint, but
   * <body> does not exist yet. */
  applyRootClasses();

  /* Shopify's router rewrites <html>'s class on some navigations, which would
   * silently drop dark mode mid-session. */
  new MutationObserver(() => {
    if (enabled && !root.classList.contains(DARK_CLASS)) applyRootClasses();
  }).observe(root, { attributes: true, attributeFilter: ['class'] });

  /* App frames have no synchronous mirror to read, and the admin re-syncs in
   * case the setting was changed in another tab. */
  watchPreference();

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
