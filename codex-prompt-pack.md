# Codex Prompt Pack — Compute Exchange
Run Stage 0 yourself, push to GitHub, then teammates each grab a Stage 1 prompt on their own branch. Paste each prompt as-is into Codex (works in Cursor too).

> **Global product guardrail:** Build the intra-organization, simulated-ledger version only. Compute Exchange never transfers vendor credits between accounts. Do not add provider credentials or API calls, proxy routing, payments, prepayment, refunds, cash-out, or redeemability in any stage. A platform-owned provider proxy is roadmap/pitch material subject to separate commercial and legal review, not a hackathon implementation seam.

---

## STAGE 0 — Scaffold (YOU run this first, target: pushed to GitHub in ~30 min)

```
Build a minimal but runnable monorepo called "compute-exchange" for a VS Code extension + shared server. Optimize for 4 other developers working in parallel immediately after this is pushed — clean file ownership boundaries, zero build-tool complexity.

STRUCTURE:
compute-exchange/
  shared/types.ts        ← single source of truth for all data contracts
  server/                ← Node + Express + ws, TypeScript, run with tsx. In-memory state only, NO database.
  extension/             ← VS Code extension, plain tsc compile (no webpack/esbuild). Webview UI is plain HTML/JS/CSS in extension/media/ (no React, no bundler).
  README.md              ← how to run server + extension in dev, and the file-ownership map

SHARED TYPES (shared/types.ts) — exactly these, exported:
- User { id, name, balance, weeklyQuota, usageHistory: number[] (14 days), predictedUsagePct }
- Listing { id, sellerId, amount, pricePerCredit, createdAt, status: "open"|"filled"|"cancelled" }
- Trade { id, listingId, buyerId, sellerId, amount, total, ts }
- Bet { id, challengerId, opponentId?, stake, game: "coinflip", status: "open"|"settled", winnerId?, ts }
- TeamSuggestion { id, fromUserId, toUserId, amount, projectedSavings, reason }
- ExchangeState { users, listings, trades, bets, suggestions }
- WsMessage = { type:"state", state } | { type:"event", text }

SERVER (port 4747):
- Seed 10 users: 5 named after our team, 5 with personality (a hoarder using ~15% of quota, a "Burnzilla" heading for overage, a steady mid user, etc). Usage histories should look believable: weekday spikes, weekend dips, some trending up.
- Simple forecast: weighted moving average of usageHistory → predictedUsagePct, recomputed on every state change.
- Endpoints (all recompute forecast + broadcast full state over WebSocket to every connected client after any mutation, plus a { type:"event", text } toast message describing what happened):
  GET  /state
  POST /listings {sellerId, amount, pricePerCredit} — escrow credits from seller
  POST /trades {listingId, buyerId} — settle, mark listing filled
  GET  /price-suggestion/:userId — suggested {amount, pricePerCredit}: bigger predicted surplus ⇒ steeper discount (floor 0.30, face value 1.0)
  POST /bets {challengerId, stake, opponentId?} — escrow stake
  POST /bets/:id/accept {userId} — server flips a coin, winner takes 2x stake, broadcast result
  POST /suggestions/:id/accept — transfer credits between the two users
- Suggestions: greedy matching — pair lowest predictedUsagePct users (surplus, <60%) with highest (deficit, >85%), transfer amount = min(free, need), projectedSavings = amount × (1.5 overage rate − 0.7 internal rate). No LP solver.
- GET /spectate — bare HTML page that opens a WebSocket and prepends every "event" message to a live feed. Dark background, monospace, will be replaced later.

EXTENSION:
- Contributes a sidebar view container "Compute Exchange" with one WebviewView.
- Settings: computeExchange.serverUrl (default http://localhost:4747) and computeExchange.userId (default "u3").
- Webview: strict CSP allowing connect-src to the server URL and its ws:// equivalent. Three tabs: Market | Team | Degen. Shared app.js handles: WebSocket connect with auto-reconnect, a window.api(path, body?) fetch helper, a global state store, toast display for "event" messages, tab switching, and a registry window.renderers = {} where each tab file registers a render(state) function.
- media/market.js, media/team.js, media/bet.js: one file per tab, each a WORKING minimal version (not empty stubs):
  market.js — order book of open listings with discount % badges, Buy buttons, and a "List my surplus" button that calls /price-suggestion then /listings.
  team.js — big headline "$X/wk team savings on the table" (sum of suggestions), suggestion cards with Accept buttons, per-user usage bars from predictedUsagePct.
  bet.js — stake input + "Open coinflip challenge" button, list of open challenges with Accept buttons, recent results list.
- Style with VS Code CSS variables (--vscode-*) so it matches the editor theme; accent color #e8ff2b.
- Top comment in each of the 3 tab files: "OWNER: <name> — replace everything below freely, keep only the window.renderers registration."

README must cover: npm install at each of server/ and extension/; run server with npx tsx src/index.ts; run extension with F5 (Extension Development Host) after npx tsc; how a teammate points computeExchange.serverUrl at another laptop's IP; file ownership map (market.js=Liam, team.js+server suggestions=Seb, bet.js=D, extension shell+integration=A, spectate+demo=E).

ACCEPTANCE: server starts clean; extension compiles with tsc and shows all 3 tabs with live data; buying a listing on one client updates another connected client via WebSocket within 1s; a full coinflip round works end-to-end. Verify all of this before finishing.
```

After it passes acceptance: `git init && gh repo create` (or push to your org), everyone clones, branches: `feat/market`, `feat/team`, `feat/degen`, `feat/spectate`.

---

## STAGE 1a — Marketplace (Liam, branch feat/market)

```
In this repo, you own extension/media/market.js and the marketplace endpoints in server/src/index.ts. Do not touch shared/types.ts (propose changes via PR), team.js, or bet.js.

Upgrade the marketplace:
1. Order book UX: sort open listings by discount (best deal first), show seller name + their predicted usage % ("selling because they'll only use 22%"), and my own listings with a Cancel button (new endpoint POST /listings/:id/cancel that refunds escrow).
2. Smarter "List my surplus": pre-fill an editable amount + price form from /price-suggestion instead of listing instantly; show projected proceeds ("earn ~340cr worth $X vs letting it expire worthless").
3. Trade history strip: last 5 trades with discount %, so the market feels alive.
4. Stretch ONLY if the above is done: a "next week futures" toggle on listing — sells predicted next-week surplus at an extra 15% discount, tagged with a FUTURES badge in the book. Reuse Listing with an added optional field (PR the type change).

Keep it plain JS, keep window.renderers.market registration, keep VS Code CSS variables. Test with two extension hosts pointed at the same server.
```

## STAGE 1b — Team Optimizer (Seb, branch feat/team)

```
In this repo, you own extension/media/team.js and the forecast/suggestion logic in server/src/index.ts. Do not touch market.js or bet.js.

Upgrade the optimizer:
1. Better forecast: make the moving average weekday-aware (weekdays vs weekends modeled separately) and expose per-user predicted end-of-week usage in credits, not just %.
2. Suggestions with narrative: each card explains the counterfactual — "Without this move, Burnzilla pays overage on ~180cr ($270). Internal transfer costs $126. Team saves $144/wk."
3. Cumulative savings counter: server tracks total realized savings from accepted suggestions; render it as the big headline and animate when it increases.
4. Sparkline per user: tiny inline SVG of their 14-day usageHistory next to their usage bar. Plain JS string-built SVG, no chart library.
5. Stretch ONLY if done: a "run week simulation" button that fast-forwards mock usage 7 days so judges can watch suggestions regenerate live.

Greedy matching stays — no solver. Keep window.renderers.team registration.
```

## STAGE 1c — Degen tab (teammate D, branch feat/degen)

```
In this repo, you own extension/media/bet.js and the bet endpoints in server/src/index.ts. Do not touch market.js or team.js.

Upgrade the degen tab:
1. Coinflip drama: on settle, 1.5s suspense animation in the webview (flipping coin emoji cycle), then result with a confetti burst (plain JS/CSS, no library) and a louder toast.
2. Targeted challenges: dropdown of users to challenge directly (opponentId), plus open challenges as today. Challenged user sees a highlighted "You've been called out" card.
3. Degen leaderboard: server tracks per-user net winnings; render Biggest Winner / Biggest Loser with crowns/clown emoji. Broadcast leaderboard changes as events so they hit the spectator feed.
4. Stretch ONLY if done: "usage race" game — two users bet on who burns more mock compute in the next 5 minutes; server simulates ticking usage and broadcasts a live progress bar.

Keep window.renderers.bet registration. House never takes a rake — credits are conserved.
```

## STAGE 2 — Integration + crowd mode (A + E, branch feat/spectate, start ~1:00 PM)

```
In this repo: deploy + spectator polish. Do not modify the three tab files.

1. Make the server deployable: read PORT from env, add a Procfile/start script, deploy to Railway (or run `cloudflared tunnel --url http://localhost:4747` and document the URL swap). Confirm wss:// works through the tunnel — the extension's CSP derives ws URL from serverUrl, so https tunnel ⇒ wss automatically.
2. Rebuild GET /spectate into a crowd-facing page: dark theme, accent #e8ff2b, three columns — live event feed, order book, degen leaderboard — plus the team savings headline huge at the top. Auto-updating from the same WebSocket. Add a QR code of the page's own URL in the corner (tiny inline QR generator, no heavy deps).
3. A "reset demo" endpoint POST /admin/reset that re-seeds state, so we can run the demo repeatedly at the science fair.
4. Smoke test: 3 extension clients + 2 phone browsers on /spectate, one full loop of trade → accept suggestion → coinflip, everything updates everywhere within 1s.
```

---

## Timeline check (3:00 hard cutoff)
- 11:00–11:40 · Stage 0 runs, acceptance passes, pushed. Teammates clone.
- 11:40–1:15 · Stages 1a/1b/1c in parallel. E drafts submission blurb + demo script.
- 1:00–1:45 · Stage 2 (A+E) while features continue.
- 1:45–2:30 · Merge branches (market → team → degen → spectate), fix conflicts, feature depth.
- 2:30 · FREEZE. Run demo loop twice. 2:45 submit. Nobody codes at 2:55.

## Merge rules (say this in the group chat)
- shared/types.ts changes: PR + one approval, nothing else needs review today.
- Each person only edits their owned files; server/src/index.ts sections are marked by feature — stay in your section.
- main must always run. If your branch breaks Stage 0 acceptance, don't merge it.
