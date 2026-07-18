# Compute Exchange backend

One Node server that holds the whole “company AI budget” simulation in memory. Extensions and the spectator page talk to it over **HTTP** (actions) and **WebSocket** (live updates). There is **no database** — restart or `POST /admin/reset` resets everything.

Stack: **Express + `ws` + TypeScript (`tsx`)**, default port **4747** (`PORT` env overrides it).

> **Product boundary:** Compute Exchange never transfers vendor credits between accounts. Credits are simulated internal allocation units. Dollar amounts are modeled cost-avoidance / chargeback estimates, not real money.

---

## Core idea

Everything important lives in one object: `ExchangeState` (see `shared/types.ts`).

| Piece | Meaning |
| --- | --- |
| `users` | People with `balance`, `weeklyQuota`, 14-day `usageHistory`, `predictedUsagePct` |
| `listings` | Credits for sale (escrowed from seller) |
| `trades` | Completed market reallocations |
| `bets` | Open/settled coinflips |
| `suggestions` | Team-recommended transfers (recomputed from forecasts, not user-authored) |

Money math uses two constants (in `server/src/index.ts`):

- **Overage** = `$1.50` / credit (painful external cost)
- **Internal** = `$0.70` / credit (cheap internal move)
- **Savings** = `$0.80` / credit moved = difference

Credits are **conserved**: listing/bet creation escrows; cancel/settle refunds or pays out; no minting outside seed/reset.

Seed data lives in `server/src/seed.ts` (10 fake users + a few open listings; listing amounts are escrowed at seed time).

---

## The universal mutation pattern

Almost every write does:

1. **Validate** input → else `4xx` with `{ error }` (never crash the process)
2. **Mutate** in-memory state
3. Call **`finishMutation(eventText)`**, which:
   - recomputes forecasts + team suggestions (`recomputeDerivedState`)
   - broadcasts `{ type: "event", text }` (toast / spectator feed line)
   - broadcasts `{ type: "state", state }` (full snapshot to every WebSocket client)

On WebSocket connect, the client immediately gets the current `state`.

That’s why two laptops stay in sync in under a second: **no diffs — full state every time.**

---

## Feature 1 — Marketplace (Suraj)

**List** — `POST /listings`

- Seller must have enough balance
- Credits leave seller balance → held on the open listing (escrow)

**Cancel** — `POST /listings/:id/cancel`

- Escrow returned to seller

**Buy** — `POST /trades`

- Buyer pays `amount × pricePerCredit` from balance
- Seller receives that payment
- Listing amount goes to buyer’s balance
- Listing → `filled`, trade recorded

**Price hint** — `GET /price-suggestion/:userId`

- Bigger predicted surplus → steeper discount suggestion
- Helps the Market UI prefill a listing

---

## Feature 2 — Forecast + Team (Seb)

This is the savings “brain.”

### Forecast (every recompute)

1. Split 14-day `usageHistory` into **weekday vs weekend** using the real calendar (newest sample = today).
2. Recency-weighted average per bucket (`weight = dayIndex + 1` in the full array).
3. Project week: `5 × weekdayDaily + 2 × weekendDaily`.
4. `predictedUsagePct = projected / weeklyQuota` (clamped 0–1).

### Match (greedy, not a solver)

- **Surplus:** predicted usage &lt; 60% and free credits after covering their projected week
- **Deficit:** predicted usage &gt; 85% and need credits to cover the gap
- Pair lowest-surplus % with highest-deficit %; transfer `min(free, need)`
- Attach a narrative reason + `projectedSavings = amount × (OVERAGE_RATE − INTERNAL_RATE)`

### Accept — `POST /suggestions/:id/accept`

- Move credits from → to
- Rebuild suggestions (that card disappears if the need is filled)

### Simulate week — `POST /team/simulate-week`

- Append 7 fake usage days (deterministic hash of user id + day offset — no `Math.random()`)
- Trim history to length 14 → recompute + broadcast

---

## Feature 3 — Coinflip (Liam + Daniel)

**Create** — `POST /bets`

- Challenger escrows stake
- Optional targeted `opponentId`

**Accept** — `POST /bets/:id/accept`

- Opponent escrows stake
- Server flips; winner gets `2 × stake`

House takes **no rake**. Purely virtual demo units with no cash value.

---

## Feature 4 — Integration + spectator (Suraj)

**Usage burst** — `POST /usage/simulate`

- Adds credits to a user’s **newest** usage day (demand signal only — does **not** burn balance)
- Triggers forecast/matcher → often creates a Team suggestion
- Seeded demo: `+300` on `u3` (D) → Credit Hoarder → D for ~200cr / ~$160/wk

**Reset** — `POST /admin/reset`

- Reload seed users/listings and clear trades/bets/suggestions derived state

**Spectator** — `GET /spectate`

- HTML page that listens on the same WebSocket and shows the live feed (and related UI)

`GET /` redirects to `/spectate`.

---

## API cheat sheet

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/state` | Full state (recomputes first) |
| GET | `/price-suggestion/:userId` | Suggested list amount/price |
| POST | `/listings` | Escrow + open listing |
| POST | `/listings/:id/cancel` | Refund escrow |
| POST | `/trades` | Settle a listing |
| POST | `/suggestions/:id/accept` | Apply team move |
| POST | `/team/simulate-week` | Fast-forward usage history |
| POST | `/bets` | Open coinflip |
| POST | `/bets/:id/accept` | Settle coinflip |
| POST | `/usage/simulate` | Fake demand spike |
| POST | `/admin/reset` | Reseed demo state |
| GET | `/spectate` | Crowd dashboard |
| WS | same host | `event` + `state` fan-out |

---

## File map

| Path | Role |
| --- | --- |
| `server/src/index.ts` | Endpoints + logic, sectioned by feature (`FEATURE 1`–`4`) |
| `server/src/seed.ts` | Initial users + listings |
| `shared/types.ts` | Shared TypeScript contracts |

---

## Invariants

1. Credits don’t appear or disappear except seed/reset.
2. Balances can’t go negative — reject the request instead.
3. Escrow on list/bet create; unlock on cancel/settle.
4. Server never trusts the client for business math beyond validated request fields.
5. Bad input → JSON `{ error }`; the process keeps running.

---

## 30-second pitch

One in-memory Express server is the source of truth. Clients mutate through REST; after every change we recompute usage forecasts and team transfer suggestions, then broadcast a short event plus the entire state over WebSocket. Marketplace escrows and trades credits, Team recommends cost-saving internal moves from forecasts, Degen settles virtual coinflips, and a usage-simulate endpoint drives the demo by changing demand without touching the ledger.
