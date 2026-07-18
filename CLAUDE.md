# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read **SYSTEM_DESIGN.md** first — it is canonical. If a request conflicts with it, flag the conflict rather than silently deviating. **AGENTS.md** holds the per-session working rules and file ownership. This is a Builders Cup 2026 hackathon project ("Compute Exchange") with a hard 3:00 PM cutoff; prefer the smallest change that works and verify manually.

## What this is

A VS Code sidebar extension where developers in one org reallocate, pool, and gamble simulated AI budget credits. It is an **internal budget-reallocation simulation** — never transfers vendor credits, never touches real money/payments/cash-out, never calls any provider API. Credits are in-memory allocation units; dollar figures are modeled cost-avoidance estimates. Keep this framing in all copy and never add provider credentials or external API calls to the critical path.

## Commands

```bash
# Server (from server/)
npm install
npx tsx src/index.ts     # or: npm run dev / npm start — HTTP + WS on http://localhost:4747
npm run typecheck        # tsc --noEmit

# Extension (from extension/)
npm install
npx tsc                  # or: npm run compile — emits ./out; npm run watch for incremental
```

Run the extension: open the repo root in VS Code, press `F5`, use the Compute Exchange icon in the Activity Bar. `http://localhost:4747/spectate` is the crowd-facing live feed. There is **no test framework** — verify by hand against the acceptance loop (below).

Multi-client: set `computeExchange.serverUrl` and `computeExchange.userId` (`u1`–`u10`) per client in VS Code settings.

## Architecture

Three-layer, one shared server:

- **`server/src/index.ts`** — the only brain. All logic (forecasting, pricing, matching, coinflip settlement, escrow, validation) is server-side. Sectioned by feature with `// ===== FEATURE N =====` comments.
- **`server/src/seed.ts`** — 10 mock users with personalities; `createSeedState()` produces the initial `ExchangeState`.
- **`extension/src/extension.ts`** — VS Code shell only: registers the WebviewView, builds the CSP'd HTML, derives ws/wss + connect-src from `serverUrl`, injects config.
- **`extension/media/*.js`** — plain vanilla JS webview, one file per tab (`market.js`, `team.js`, `bet.js`) plus the shared runtime `app.js`. No React, no bundler, no npm packages in the webview.
- **`shared/types.ts`** — the data contracts, imported by both server and (conceptually) the tabs.

### The two contracts that hold it together

1. **Full-state broadcast.** Every mutation follows: **validate → mutate → recompute derived state → broadcast `{type:"event"}` then `{type:"state"}`** to all WS clients. Use the `finishMutation(eventText)` helper in `index.ts` — it calls `recomputeDerivedState()` then broadcasts both messages. There is no diffing or per-client state; the entire `ExchangeState` is re-sent each time. A tab that mutates without the server broadcasting is a bug.

2. **Renderer registry.** Each tab file registers `window.renderers.<tab> = (state) => {...}`. `app.js` calls every renderer on every `state` message. That registration is the *only* shell↔tab contract — keep it intact. `app.js` also exposes `window.api(path, body)` (GET when body is undefined, POST otherwise; toasts errors), `window.toast`, `window.escapeHtml`, `window.userById`, and `window.currentUserId`. Tabs use event delegation via `data-*` attributes and template-literal `innerHTML` rendering.

### Derived state

`recomputeDerivedState()` (runs on connect, every `/state` GET, and inside every mutation) rewrites `user.predictedUsagePct` from a weighted moving average of `usageHistory` and rebuilds `state.suggestions` via greedy surplus→deficit matching. Never persist derived fields as ground truth; they are recomputed. `OVERAGE_RATE = 1.5` and `INTERNAL_RATE = 0.7` drive the dollar savings math.

## Hard constraints

- **Dependencies are frozen**: express, cors, ws, tsx, typescript, @types/*. Adding anything else needs a stated reason.
- **In-memory only** — no DB, no ORM, no file persistence. A crash losing fake credits is acceptable.
- **Credits are conserved**: escrow on listing/bet creation, refund on cancel, no minting outside seed. Reject any op that would make a balance negative (return `4xx` + `{error}`, never crash the process).
- **`shared/types.ts` is PR-only** — do not edit unless the task explicitly says so; propose changes in your summary.
- Theming uses VS Code CSS variables; accent color is `#e8ff2b`.

## File ownership (stay in your lane)

`market.js` + marketplace server section → Liam · `team.js` + forecast/suggestions section → Seb · `bet.js` + bets section → D · `extension/src/`, `app.js`, `/spectate`, deploy → A/E. Only edit outside your feature's marked server section to fix a bug you introduced.

## Acceptance loop (verify before finishing)

Server starts clean with `npx tsx src/index.ts`; extension compiles with `npx tsc`; two clients sync a trade in under 1s; a full coinflip round opens, settles, pays exactly `2 × stake`, and broadcasts the result. `main` must always run.

## Implemented API (Stage 0)

`GET /state` · `GET /price-suggestion/:userId` · `POST /listings` · `POST /trades` · `POST /suggestions/:id/accept` · `POST /bets` · `POST /bets/:id/accept` · `GET /spectate`. Note: `POST /listings/:id/cancel` and `POST /admin/reset` appear in SYSTEM_DESIGN.md but are Stage 1/2 roadmap and **not yet implemented**.
