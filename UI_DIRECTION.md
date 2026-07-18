# UI Direction — Quiet, Phone-Like, Still Native to VS Code

## Goal

Make Compute Exchange feel like a polished iPhone utility through hierarchy, spacing, rounded surfaces, and restrained motion—not by drawing a fake phone frame. Keep plain HTML/JS/CSS, VS Code theme compatibility, `#e8ff2b`, and every `window.renderers.<tab>` registration.

## Shared tokens

```css
:root {
  --accent: #e8ff2b;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --radius-sm: 10px;
  --radius-md: 16px;
  --radius-lg: 20px;
  --tap: 44px;
  --motion: 180ms cubic-bezier(.2, .8, .2, 1);
  --surface-1: var(--vscode-sideBar-background, #111);
  --surface-2: var(--vscode-editorWidget-background, var(--vscode-sideBarSectionHeader-background, rgba(127, 127, 127, .10)));
  --text-muted: var(--vscode-descriptionForeground);
  --border: var(--vscode-contrastBorder, var(--vscode-panel-border, rgba(127, 127, 127, .28)));
  --shadow: 0 10px 30px rgba(0, 0, 0, .16);
}
```

Inside VS Code use `var(--vscode-font-family), -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif`; the spectator page may put the system fonts first. Reserve the accent for the primary action, selected tab, live status, and key savings number.

## Shell and shared components

- Use a sticky compact header with product name, a text-and-dot connection pill, and “Internal demo units · no cash-out.”
- Turn the three tabs into a rounded segmented control. Keep the existing tab IDs and click contract, and add `tablist`/`tab`/`tabpanel` semantics, `aria-selected`, `aria-controls`, and Left/Right/Home/End keyboard navigation.
- Use a mobile-first single column, `12px` page padding, and `16–24px` section gaps.
- Give controls a `44px` minimum target, `12px` radius, and visible `:focus-visible` outline using `var(--vscode-focusBorder, #e8ff2b)`.
- Define reusable `.hero`, `.metric`, `.segmented`, `.stack`, `.card`, `.card-row`, `.chip`, `.action-row`, `.status-pill`, `.sheet`, and `.empty` styles in shared CSS.
- Use `150–180ms` opacity/transform motion and disable it under `prefers-reduced-motion`. Under `forced-colors`, remove shadows and rely on contrast borders.
- Keep one obvious primary action per card; remove decorative borders and all-uppercase debug copy where hierarchy already communicates meaning.

## Tab hierarchy

### Market and usage demo — Suraj

1. Hero: available allocation in large tabular type, forecast below it.
2. Demo workload card: **Run 300cr agent burst**, with a short explanation of what will change.
3. Full-width **List surplus** action that opens an inline sheet instead of mutating immediately.
4. Allocation cards: amount first, rate second, seller context third, one compact Buy action.
5. After a burst, show a clear handoff: **Forecast changed—open Team to apply the allocation.**

### Team and forecasting — Seb

1. Keep `$X/wk` estimated savings as the dominant hero.
2. Collapse it to a compact sticky summary beneath the shell tabs while scrolling so it remains visible.
3. Show the best recommendation first with a full-width **Apply move** action.
4. Put remaining recommendations in quieter cards.
5. Forecast rows show name, textual percentage, and an `8px` rounded bar; business-status thresholds stay server-owned.
6. Use tiny inline SVG sparklines only; no chart dependency.

### Degen and games — Liam + Daniel

1. Pair virtual balance with a visible **Virtual only** guardrail.
2. Present games as large tappable tiles.
3. Put stake selection in a compact sheet with preset chips.
4. Separate challenges and recent wins with clear spacing.
5. Preserve no-cash-value and no-redemption language for every new game.

### Spectator — Suraj

- Use system typography, `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">`, safe-area padding, and a sticky live header.
- Show the current savings metric before the event feed.
- Use `16–20px` rounded event cards and human-readable timestamps.
- Optimize first for `320–430px`; center at a maximum width around `680px` on desktop.
- Show “Waiting for the next team move” before the first event.

## Implementation order

1. Suraj lands shared tokens, typography, sticky chrome, segmented tabs, accessibility, and primitives.
2. Suraj adds the Market hero, workload demo, cards, and listing sheet.
3. Seb applies the shared primitives to Team without changing shell CSS; missing styles are requested from Suraj with `team-*` class names.
4. Liam + Daniel apply them to Degen and new games; missing styles are requested from Suraj with `degen-*` class names.
5. Suraj finishes the phone-readable spectator page and integration pass.

Suraj remains the sole `styles.css` editor and keeps owner-namespaced Team and Degen sections so parallel branches do not collide.

## Visual acceptance

- No horizontal scroll at `240px`, `320px`, or `420px` widths.
- Every interactive target is at least `44px`.
- Keyboard focus is visible and status is never communicated by color alone.
- Toasts do not cover the current primary action.
- Reduced-motion preference is honored.
- Light, dark, and high-contrast VS Code themes remain legible.
- No endpoint, state contract, renderer registration, framework, bundler, or dependency is added for visual polish.
