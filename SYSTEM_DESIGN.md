# SYSTEM_DESIGN.md — Compute Exchange
Commit this at the repo root. Every Codex session should read this before writing code.

## What this is

A VS Code sidebar extension where developers inside one organization reallocate, pool, and play with simulated AI budget credits. Built in one day (Builders Cup 2026), with a hard 3:00 PM cutoff. Main track: Save Time / Save Money. Secondary: Audience Favorite via a live crowd-facing spectator page.

**Product boundary:** Compute Exchange never transfers vendor credits between accounts—it is an internal budget-reallocation layer over an organization's existing spend. Stage 0 credits are in-memory allocation units, not vendor service credits, money, stored value, or redeemable rewards. The demo never accepts provider credentials, calls provider APIs, or offers deposits, withdrawals, payments, or cash-out.

The pitch in one number: teams buy AI credits, most devs use a fraction of them, that surplus is wasted money. We make it liquid. The Team tab's "$X/wk savings" headline IS the product thesis — it must always be visible and always be real math from the model.

## Architecture

```
 laptop A ┐
 laptop B ┼─ VS Code extension (sidebar WebviewView, plain HTML/JS tabs)
 laptop C ┘        │  HTTP (mutations) + WebSocket (state fan-out)
                   ▼
        Exchange server — ONE instance
        Node + Express + ws, TypeScript via tsx
        ALL state in memory. All logic server-side.
                   │  same WebSocket
                   ▼
        /spectate — public page, crowd opens on phones (QR at our booth)
```

Design rules that make this work in 4 hours:
1. **Server is the only brain.** Forecasting, pricing, matching, bet settlement, escrow — all server-side. Webview tabs are dumb renderers + button handlers. This is what lets 3 people build 3 tabs without coordinating.
2. **Full-state broadcast.** After ANY mutation the server recomputes forecasts + suggestions and broadcasts the ENTIRE `ExchangeState` to every WS client, plus a human-readable `event` string. No diffing, no per-client state, no sync bugs. State is tiny; this is fine.
3. **In-memory only.** No DB, no ORM, no persistence. `POST /admin/reset` re-seeds for repeatable demos. A crash loses fake credits — acceptable.
4. **No build tooling in the webview.** Plain HTML/JS/CSS in `extension/media/`, one file per tab. Extension host compiles with plain `tsc`. No React, no bundler, no exceptions.

## Repo layout & ownership

```
shared/types.ts        contracts — PR-only changes, everyone imports these
server/src/index.ts    endpoints + core logic, sectioned by feature (stay in your section)
server/src/seed.ts     10 mock users with personality (hoarder, Burnzilla, etc.)
extension/src/         VS Code shell: view registration, CSP, settings — owner Suraj
extension/media/app.js shared webview runtime: WS client w/ reconnect, api() helper,
                       state store, toasts, tab switching, window.renderers registry — owner Suraj
extension/media/market.js  Feature 1 — Suraj
extension/media/team.js    Feature 2 — Seb (+ forecast/matching section of server)
extension/media/bet.js     Feature 3 — Liam + Daniel
/usage/simulate, /spectate, shared UI, deploy — Suraj
```

Each tab file registers `window.renderers.<tab> = (state) => {...}` and the shared runtime calls every renderer on every state broadcast. That registration is the only contract between shell and tabs.

## Data contracts (shared/types.ts — exact shapes)

```ts
User           { id, name, balance, weeklyQuota, usageHistory: number[/*14 days*/], predictedUsagePct }
Listing        { id, sellerId, amount, pricePerCredit, createdAt, status: "open"|"filled"|"cancelled" }
Trade          { id, listingId, buyerId, sellerId, amount, total, ts }
Bet            { id, challengerId, opponentId?, stake, game: "coinflip", status: "open"|"settled", winnerId?, ts }
TeamSuggestion { id, fromUserId, toUserId, amount, projectedSavings, reason }
ExchangeState  { users, listings, trades, bets, suggestions }
WsMessage      { type: "state", state } | { type: "event", text }
```

Simulated internal credits are the universal unit. Face value 1.0 is a modeled internal chargeback baseline, not cash value. Dollar cost-avoidance framing uses two constants: `OVERAGE_RATE = 1.5` $/credit, `INTERNAL_RATE = 0.7` $/credit.

## API surface

| Method | Path | Body | Effect |
|---|---|---|---|
| GET | /state | — | full ExchangeState (forecast recomputed) |
| POST | /listings | sellerId, amount, pricePerCredit | escrow seller credits, open listing |
| POST | /listings/:id/cancel | — | refund escrow (Stage 1a) |
| POST | /trades | listingId, buyerId | settle, listing → filled |
| GET | /price-suggestion/:userId | — | {amount, pricePerCredit} from surplus curve |
| POST | /suggestions/:id/accept | — | transfer credits per suggestion |
| POST | /usage/simulate | userId, credits | record simulated demand; recompute forecast (Stage 0.5) |
| POST | /bets | challengerId, stake, opponentId? | escrow stake, open bet |
| POST | /bets/:id/accept | userId | escrow acceptor, flip, winner +2× stake |
| POST | /admin/reset | — | re-seed everything (Stage 2) |
| GET | /spectate | — | crowd page (WS-driven feed) |

Every mutation: validate → mutate → recompute forecast + suggestions → broadcast `event` then `state`. Error = 4xx + `{error}`; never crash the process on bad input.

## Core logic (all server-side)

**Forecast** — weighted moving average of 14-day `usageHistory` (recent days weigh more; Stage 1b makes it weekday-aware) → `predictedUsagePct = min(1, projectedWeekly / weeklyQuota)`.

**Pricing curve** (`/price-suggestion`) — bigger predicted surplus ⇒ steeper suggested discount. `surplusPct = max(0, 0.9 − predictedUsagePct)`; suggest listing half the surplus at `price = max(0.30, 1 − surplusPct)`. Rationale: use-it-or-lose-it credits should clear fast.

**Team matching** — greedy, NOT a solver: sort surplus users (<60% predicted) ascending, deficit users (>85%) descending, pair off, `amount = min(free, need)`, `projectedSavings = amount × (OVERAGE_RATE − INTERNAL_RATE)`. Greedy demos identically to optimal and ships by lunch.

**Usage demo** — `POST /usage/simulate` adds normalized demand to the newest history sample, then uses the normal recompute-and-broadcast path. Usage changes the forecast; accepting the resulting suggestion moves conserved allocation. Usage is a demand meter and does not burn ledger balance. The exact seeded loop and validation contract live in [`USAGE_TRANSFER_SPEC.md`](./USAGE_TRANSFER_SPEC.md).

**Coinflip** — server-authoritative `Math.random()`, winner takes 2× virtual stake. It has no cash value, redemption path, or external effect.

**Invariants (never violate):**
- Credits are conserved. Escrow on listing/bet creation; refund on cancel; no rake, no minting outside seed/reset.
- A user's spendable balance never goes negative; reject instead.
- Server never trusts client-computed amounts/prices except where the user explicitly edits a pre-filled form.
- Every mutation broadcasts. A tab that mutates without the server broadcasting is a bug.

## Deployment (Stage 2)

Server reads `PORT` from env. Demo day: `cloudflared tunnel --url http://localhost:4747` from one laptop (or Railway if time). Extension setting `computeExchange.serverUrl` is the only knob — CSP and ws/wss URL derive from it, so an https tunnel automatically means wss. `computeExchange.userId` maps each laptop to a seeded user.

## Stages

- **0** — scaffold above, all 3 tabs minimally working, acceptance: 2 clients sync a trade <1s, full coinflip round works. Push, everyone clones.
- **1a/1b/1c** — parallel work on Suraj's `feat/integration-ui`, Seb's `feat/team`, and Liam + Daniel's `feat/degen` (see prompt pack).
- **2** — Suraj finishes the tunnel, spectator page, reset endpoint, and integration on `feat/integration-ui`.
- Merge by 2:30, freeze 2:30, submit 2:45. main must always run.

## Explicit non-goals (do not build these)

Auth/identity (userId in settings is enough) · persistence · payments/real money · prepayment/refunds/cash-out · provider credentials · React or any bundler · per-client state diffs · an optimization solver · Cursor Admin API integration · any external API in the critical path. Real usage data (OpenAI org usage, Ramp sandbox spend) is a post-Stage-2 bolt-on behind a `DataProvider` seam ONLY if we're ahead of schedule and a mentor hands us credentials — the demo must never depend on it.

**Roadmap only — not an implementation seam:** a future product might become the provider API account holder and route requests through its own customer application. That model requires provider-specific commercial approval plus payments, refunds, privacy, moderation, geographic, and abuse review. Do not add proxy routing or financial mechanics during the hackathon.

## Demo requirements (product decisions, not polish)

Repeatable via /admin/reset · simulated workload changes forecast and creates a real transfer recommendation · two-laptop trade visible <1s · savings headline reacts to Accept · coinflip has suspense + result broadcast to spectator feed · spectator page self-explains to a stranger holding a phone.
