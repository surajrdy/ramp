---
title: "feat: Add games hub and wheel spin game to Degen tab"
type: feat
status: active
date: 2026-07-18
---

# feat: Add games hub and wheel spin game to Degen tab

## Overview

Restructure the Degen tab from a single coinflip game into a multi-game hub with sub-navigation, and add a "Wheel Spin" game where 2–6 players wager credits into a weighted lottery visualized as a spinning pie chart.

## Problem Frame

The Degen tab currently only has coinflip. The team wants 3 games total. This plan scaffolds the multi-game UI and fully implements the first new game — a multiplayer wheel spin where the chance of winning is proportional to your wager.

## Requirements Trace

- R1. Degen tab supports switching between 3 games (Coinflip, Wheel Spin, TBD)
- R2. Wheel Spin: 2–6 players each wager credits into a shared pot
- R3. Pie chart sections are proportional to each player's wager amount
- R4. Animated wheel spin determines the winner
- R5. Winner receives the entire pot
- R6. Credits are conserved: escrow on join, winner gets total pot, no minting
- R7. All logic is server-authoritative; webview is a dumb renderer
- R8. All work on a separate branch (`feat/degen-games`)

## Scope Boundaries

- Only the Wheel Spin game is fully implemented; the third game slot is a placeholder
- No changes to the Market or Team tabs
- No changes to the existing coinflip server logic or endpoints
- `shared/types.ts` changes will be proposed (required for `ExchangeState.wheelGames`)

## Context & Research

### Relevant Code and Patterns

- `extension/media/bet.js` — current Degen tab renderer; registers `window.renderers.bet`
- `extension/media/app.js` — shared runtime: `window.api()`, `window.toast()`, `window.renderers` registry, tab switching via `data-tab`
- `server/src/index.ts:278-382` — Feature 3 section (coinflip endpoints), `finishMutation()` pattern
- `extension/src/extension.ts:77-79` — script tags loaded in webview HTML
- `extension/media/styles.css` — VS Code CSS variable theming, accent `#e8ff2b`
- Mutation pattern: validate → mutate state → `finishMutation(eventText)` → response

### Institutional Learnings

- No `docs/solutions/` exists yet. Key conventions from CLAUDE.md/AGENTS.md:
  - Plain vanilla JS, template literals, event delegation via `data-*` attributes
  - Credits must be conserved; escrow on creation, refund on cancel
  - Every mutation broadcasts state to all WS clients
  - No new dependencies allowed

## Key Technical Decisions

- **Sub-navigation within Degen tab**: Use a row of game-selector buttons inside the `#bet` panel, rendered by `bet.js`. This avoids touching the top-level tab system owned by A/E. The selected game is tracked in a module-level variable, not server state.
- **Separate file per game**: `wheel.js` handles wheel rendering and interaction. `bet.js` orchestrates the sub-nav and delegates to per-game renderers via a `window.gameRenderers` registry (mirrors the `window.renderers` pattern). This lets multiple people work on games without merge conflicts.
- **Canvas for the wheel**: The pie chart and spin animation use the Canvas API — available in VS Code webviews, no dependencies needed. CSS rotation alone can't draw variable-sized pie segments.
- **Server data model**: A new `WheelGame` structure separate from `Bet`, since wheel games are fundamentally multi-player with variable wagers per player. Stored in `state.wheelGames[]`.
- **Spin trigger**: The game creator triggers the spin manually via a "Spin" button (minimum 2 players required). No auto-start — this creates suspense and lets the creator wait for more players.
- **Winner selection**: Server-side weighted random — each player's probability equals `their_wager / total_pot`. The winner receives the full `totalPot`.

## Open Questions

### Resolved During Planning

- **How to handle the sub-nav state?** Module-level variable in `bet.js`, not persisted to server. Each render pass checks the variable and renders the selected game.
- **Should the creator set max players?** No — keep it simple. Any game accepts 2–6 players. Creator spins when ready.
- **Spin animation timing?** Client-side only — the server immediately resolves the winner. The client animates toward the known result (spin angle is derived from `winnerId`). This avoids WS timing issues.

### Deferred to Implementation

- Exact easing curve and duration for the spin animation
- Whether to add sound/haptic feedback (stretch goal, probably not)
- Color assignment per player (can use a fixed palette indexed by player order)

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification.*

```
Game lifecycle:

  Creator POST /games/wheel {creatorId, wager}
    → server escrows creator's wager
    → adds WheelGame {status:"waiting", players:[{userId, wager}]}
    → broadcasts state

  Player POST /games/wheel/:id/join {userId, wager}
    → server escrows joiner's wager
    → pushes to game.players[], updates totalPot
    → broadcasts state

  Creator POST /games/wheel/:id/spin {}
    → server validates >=2 players, creator is caller
    → weighted random picks winnerId
    → winner.balance += totalPot
    → game.status = "settled"
    → broadcasts state + event

  Client animation:
    → On state update with status:"settled", bet.js detects transition
    → wheel.js calculates target angle from winnerId's pie segment
    → Animates canvas rotation to land on winner's segment
    → Shows result after animation completes
```

## Implementation Units

- [ ] **Unit 1: Create branch and propose types**

  **Goal:** Set up `feat/degen-games` branch and define the `WheelGame` data model in `shared/types.ts`.

  **Requirements:** R2, R6, R8

  **Dependencies:** None

  **Files:**
  - Modify: `shared/types.ts`

  **Approach:**
  - Create and checkout `feat/degen-games` from current HEAD
  - Add `WheelGame` interface: `{ id, creatorId, players: {userId, wager}[], status: "waiting"|"spinning"|"settled", winnerId?, totalPot, ts }`
  - Add `wheelGames: WheelGame[]` to `ExchangeState`

  **Patterns to follow:**
  - Existing `Bet` interface shape (id, status union, ts, winnerId optional)
  - `ExchangeState` array pattern (users, listings, trades, bets)

  **Test expectation:** none — pure type definitions

  **Verification:**
  - `npx tsc --noEmit` in `server/` passes with the new types

- [ ] **Unit 2: Server endpoints for wheel game**

  **Goal:** Add create, join, and spin endpoints inside the Feature 3 section of the server.

  **Requirements:** R2, R5, R6, R7

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `server/src/index.ts` (within `// ===== FEATURE 3 =====` section)
  - Modify: `server/src/seed.ts` (add `wheelGames: []` to seed state)

  **Approach:**
  - Add `let nextWheelGameId = 1` counter
  - Initialize `state.wheelGames = []` in seed
  - `POST /games/wheel` — validate creatorId + wager, escrow wager from creator balance, create game with status `"waiting"`, `finishMutation()`
  - `POST /games/wheel/:id/join` — validate userId + wager, check not already in game, check game is `"waiting"`, check player count < 6, escrow wager, push to players array, update totalPot, `finishMutation()`
  - `POST /games/wheel/:id/spin` — validate game is `"waiting"`, validate >= 2 players, validate caller is creator. Weighted random: cumulative wager scan, `Math.random() * totalPot`, find winner. Set `status = "settled"`, `winnerId`, credit `winner.balance += totalPot`, `finishMutation()`
  - Validation: reject negative balance, reject duplicate join, reject spin with < 2 players, reject non-creator spin

  **Patterns to follow:**
  - `POST /bets` and `POST /bets/:id/accept` for escrow + validation + finishMutation pattern
  - `isRecord()`, `isPositiveInteger()`, `userById()`, `sendError()` helpers

  **Test scenarios:**
  - Happy path: create game → 2 players join → creator spins → winner gets totalPot, both players' escrow is consumed, game status is "settled"
  - Happy path: create game with 6 players, all different wagers, winner gets correct total
  - Edge case: player tries to join with more credits than their balance → 409
  - Edge case: creator tries to spin with only 1 player (themselves) → 400
  - Edge case: player tries to join a "settled" game → 409
  - Edge case: player tries to join a game they're already in → 409
  - Error path: non-creator tries to spin → 403
  - Error path: invalid wager (0, negative, non-integer) → 400
  - Integration: every mutation (create, join, spin) broadcasts state to all WS clients

  **Verification:**
  - Server starts with `npx tsx src/index.ts`
  - Manual curl: create a wheel game, join with a second user, spin, confirm winner balance = previous + totalPot
  - Confirm state broadcast arrives on WS clients after each mutation

- [ ] **Unit 3: Restructure Degen tab as game hub**

  **Goal:** Transform `bet.js` into a game selector that switches between sub-views (Coinflip, Wheel Spin, placeholder).

  **Requirements:** R1

  **Dependencies:** Unit 1 (needs `wheelGames` in state for rendering)

  **Files:**
  - Modify: `extension/media/bet.js`
  - Modify: `extension/media/styles.css`

  **Approach:**
  - Add a module-level `selectedGame` variable (default: `"coinflip"`)
  - Render a game-selector bar at the top of `#bet` panel: three buttons (Coinflip, Wheel Spin, ???) using `data-game` attributes
  - Move existing coinflip rendering into a local function
  - Add a `window.gameRenderers` registry object; `bet.js` renderer calls `window.gameRenderers[selectedGame]?.(state, panel)` to render the active game's content below the selector
  - Register the coinflip renderer as `window.gameRenderers.coinflip`
  - Handle `data-game` click via event delegation to switch `selectedGame` and re-render
  - The third game button is present but disabled/grayed with "Coming Soon"

  **Patterns to follow:**
  - Top-level tab switching in `app.js` (classList toggle on `data-tab` buttons)
  - Event delegation via `data-*` attributes throughout the codebase
  - Existing coinflip form submission and accept-click handlers in `bet.js`

  **Test scenarios:**
  - Happy path: clicking game selector buttons switches the visible game content
  - Happy path: coinflip still works identically after restructure (create challenge, accept, settle)
  - Edge case: "Coming Soon" third game button is not clickable
  - Integration: state broadcasts still trigger correct re-render for whichever game is selected

  **Verification:**
  - Extension compiles with `npx tsc`
  - Coinflip game works exactly as before within the new sub-nav
  - Game selector visually matches the existing tab style (accent color active state)

- [ ] **Unit 4: Wheel spin game UI and animation**

  **Goal:** Build the wheel spin game view with lobby, pie chart visualization, spin animation, and results display.

  **Requirements:** R2, R3, R4, R5

  **Dependencies:** Unit 2 (server endpoints), Unit 3 (game hub + gameRenderers registry)

  **Files:**
  - Create: `extension/media/wheel.js`
  - Modify: `extension/src/extension.ts` (add `<script>` tag for wheel.js)
  - Modify: `extension/media/styles.css` (wheel-specific styles)

  **Approach:**
  - Register `window.gameRenderers.wheel = (state, container) => {...}`
  - **Lobby view** (when no active game or browsing): show create form (wager input + "Create Game" button) and list of waiting games with player counts and "Join" buttons with wager input
  - **Waiting view** (in a game, waiting for players): show the pie chart preview (Canvas) with current players + wagers, player list, "Spin!" button (creator only, enabled when >= 2 players), "Leave" option
  - **Spin animation**: on detecting a game transition to `"settled"`, animate the canvas wheel spinning and decelerating to land on the winner's segment. Calculate target angle from winner's position in the pie. Use `requestAnimationFrame` loop with decaying angular velocity
  - **Result view**: after animation, highlight winner segment, show "{name} won {totalPot}cr!" overlay
  - **Canvas rendering**: draw pie segments colored from a fixed 6-color palette, each segment labeled with player name + wager. Pointer/arrow indicator at the top of the wheel
  - Add `<script>` for `wheel.js` in extension.ts HTML template, loaded before `bet.js`

  **Patterns to follow:**
  - Template-literal innerHTML for non-canvas UI elements (lobby, player list, buttons)
  - `window.api()` for all HTTP calls
  - Event delegation with `data-*` attributes for button handlers
  - Canvas API for pie chart drawing (standard `arc()` + `fill()`)

  **Test scenarios:**
  - Happy path: create game → see pie chart with single segment → second player joins → pie updates to show proportional segments → creator clicks Spin → wheel animates → lands on winner → result displayed
  - Happy path: pie chart proportions match wager ratios (player with 2x wager gets 2x segment size)
  - Happy path: 6 players all with different wagers renders correctly
  - Edge case: player without enough balance sees disabled Join button or gets toast error
  - Edge case: non-creator does not see the Spin button
  - Edge case: state update mid-animation (another game settles) doesn't break current animation
  - Integration: multiple WS clients see the same game state; spectator page gets wheel spin event text

  **Verification:**
  - Extension compiles with `npx tsc`
  - Full round works: create → join → spin → winner credited
  - Pie chart visually shows proportional segments
  - Animation plays and lands on the correct winner segment
  - Two VS Code clients see the same game state in real-time

## System-Wide Impact

- **State broadcast size:** Adding `wheelGames[]` to `ExchangeState` increases broadcast payload. Negligible for in-memory demo with small arrays.
- **Existing coinflip:** No changes to coinflip endpoints or logic. The coinflip UI moves into a sub-function but behavior is identical.
- **Spectator page:** Wheel spin events will appear in the `/spectate` feed automatically via `finishMutation()` — no spectate changes needed.
- **Credit conservation:** Escrow on create/join, full pot to winner on settle. No credits minted or destroyed. Same invariant as coinflip.
- **Extension.ts:** Adding one `<script>` tag for `wheel.js`. Minimal blast radius — same pattern as existing market/team/bet scripts.
- **Unchanged invariants:** Top-level tab switching, WS reconnect, `window.renderers.bet` registration, all existing API endpoints.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `shared/types.ts` is PR-only — editing it requires explicit approval | Plan proposes minimal additions (one interface, one field on ExchangeState). Liam + D are both on this feature and can approve. |
| Canvas rendering in VS Code webview CSP | Canvas API is allowed under `default-src 'none'` since it doesn't load external resources. No CSP changes needed. |
| Spin animation feels janky | Use `requestAnimationFrame` with easing. The result is known immediately (server-resolved), so the animation is cosmetic — it always lands correctly. |
| Merge conflicts with other feature branches | Working on `feat/degen-games` branch, only touching Feature 3 files + types.ts. Minimal overlap with market.js or team.js work. |

## Proposed `shared/types.ts` Changes

```ts
// Add after Bet interface:
export interface WheelPlayer {
  userId: string;
  wager: number;
}

export interface WheelGame {
  id: string;
  creatorId: string;
  players: WheelPlayer[];
  status: "waiting" | "spinning" | "settled";
  winnerId?: string;
  totalPot: number;
  ts: string;
}

// Add to ExchangeState:
wheelGames: WheelGame[];
```

## Sources & References

- Codebase: `server/src/index.ts` (mutation + broadcast pattern), `extension/media/bet.js` (current degen tab), `extension/media/app.js` (renderer registry)
- SYSTEM_DESIGN.md (architecture rules, invariants)
- AGENTS.md (file ownership, working style)
