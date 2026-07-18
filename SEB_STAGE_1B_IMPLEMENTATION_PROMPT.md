# Codex / Cursor prompt — Seb Stage 1b Team Optimizer

Paste this entire file as the user message in a **fresh** agent session. Read `SYSTEM_DESIGN.md` and `AGENTS.md` first. Implement exactly what is specified below. Do not invent scope. Do not wait on other feature branches.

---

## Who you are and what you own

You are **Seb**. Branch: **`feat/team`** from latest `main`.

**Edit only:**

| Path | What |
| --- | --- |
| `server/src/index.ts` | Inside `// ===== FEATURE 2: FORECAST + TEAM SUGGESTIONS (Seb) =====` through the line before `// ===== FEATURE 3` only |
| `server/src/seed.ts` | Add `realizedSavings: 0` to the object returned by `createSeedState()` |
| `shared/types.ts` | Add `realizedSavings: number` to `ExchangeState` only |
| `extension/media/team.js` | Full Team tab UI rewrite; keep `window.renderers.team` registration |
| `extension/media/styles.css` | Add only `.sparkline`, `.savings-sub`, `.savings-bump` (+ `@keyframes` if needed) |

**Do not edit:** `market.js`, `bet.js`, `app.js`, `extension/src/**`, FEATURE 1 / 3 / 4 sections of `server/src/index.ts`, listing/bet/trade types, or any new dependencies.

**Product guardrail:** in-memory simulated internal allocation only. No provider APIs, payments, cash-out, React, bundler, or npm packages in the webview.

---

## Goal (must-ship order)

Finish items **1 → 4** before any stretch.

1. Weekday-aware forecast; show projected usage in **credits** in the UI  
2. Narrative counterfactual suggestion `reason` strings  
3. Cumulative **realized** savings headline + bump animation  
4. 14-day sparklines per user  
5. **Stretch only if 1–4 done:** `POST /team/simulate-week` + Team tab button  

---

## Ambiguities resolved (do not reopen)

These were open design questions; treat the following as law for this implementation.

### A. Weekend vs weekday classification

- `usageHistory[0]` = oldest, `usageHistory[n-1]` = **today** (local machine date).
- For index `i`, calendar day = local midnight today minus `(n - 1 - i)` days.
- Weekend = `getDay() === 0 || getDay() === 6` (Sun/Sat). Everything else weekday.
- Do **not** use fixed `i % 7` buckets; seed data is approximate, calendar is the rule.

### B. Weekday-aware projection formula

Replace `projectedWeeklyUsage(user)` with:

1. Split history into weekday samples and weekend samples.  
2. Within each bucket, compute a **recency-weighted** daily average using global index weights `weight = index + 1` (same spirit as Stage 0).  
3. Empty-bucket fallback:  
   - If one bucket is empty, use the other bucket’s daily average for both.  
   - If both empty, return `0`.  
4. `projectedWeekly = 5 * weekdayDaily + 2 * weekendDaily`.  
5. In `recomputeDerivedState`, keep:  
   `user.predictedUsagePct = round(clamp(projectedWeekly / user.weeklyQuota, 0, 1), 4)`.

Do **not** add `predictedWeeklyCredits` to `shared/types.ts`. The webview derives display credits as:

`Math.round(user.predictedUsagePct * user.weeklyQuota)`.

### C. Greedy matching (unchanged thresholds)

Keep Stage 0 pairing logic:

- Surplus: `predictedUsagePct < 0.6`, free = `floor(balance - projectedWeeklyUsage(user))`  
- Deficit: `predictedUsagePct > 0.85`, need = `ceil(projectedWeeklyUsage(user) - balance)`  
- Pair lowest surplus pct with highest deficit pct; `amount = min(free, need)`  
- `projectedSavings = round(amount * (OVERAGE_RATE - INTERNAL_RATE), 2)`  
- Use existing module constants `OVERAGE_RATE = 1.5` and `INTERNAL_RATE = 0.7` (already above FEATURE 1 — read them, do not move or duplicate).

### D. Exact narrative `reason` format

For each suggestion, set:

```text
Without this move, {toName} pays overage on ~{amount}cr (${overageDollars}). Internal transfer costs ${internalDollars}. Team saves ${savingsDollars}/wk.
```

Where:

- `overageDollars = (amount * OVERAGE_RATE).toFixed(2)`  
- `internalDollars = (amount * INTERNAL_RATE).toFixed(2)`  
- `savingsDollars = projectedSavings.toFixed(2)`  
- Names from current user objects at build time  

One string, single line (no markdown). UI renders it in the existing muted reason area.

### E. `realizedSavings` contract

In `shared/types.ts`:

```ts
export interface ExchangeState {
  users: User[];
  listings: Listing[];
  trades: Trade[];
  bets: Bet[];
  suggestions: TeamSuggestion[];
  realizedSavings: number;
}
```

In `createSeedState()` return value: `realizedSavings: 0` (with existing empty arrays).

On successful `POST /suggestions/:id/accept`, **after** balance transfer and **before** `finishMutation`:

```ts
state.realizedSavings = round(state.realizedSavings + suggestion.projectedSavings, 2);
```

Event text (exact shape):

```text
{amount} credits moved from {from} to {to}, avoiding an estimated ${projectedSavings}/wk. Realized team savings: ${realizedSavings}.
```

(Use `.toFixed(2)` on dollar amounts.)

Anyone may accept (Stage 0 behavior). Request body ignored. Missing suggestion → `404` `{error}`; insufficient balance → `409` `{error}`. Never crash.

Accepting again later for a newly rebuilt suggestion **does** add again (demo-friendly).

### F. Team tab hero copy (exact)

Primary (existing `.savings` styling):

```html
<div class="savings [savings-bump?]"><span class="currency">$</span>{realized.toFixed(2)}<small>realized team savings (estimated cost avoidance)</small></div>
```

Secondary line under it:

```html
<div class="savings-sub">${onTable.toFixed(2)}/wk still on the table</div>
```

Where `onTable = sum(suggestions[].projectedSavings)`.

**Bump animation rules:**

- Module-level `let lastRealized = null` inside the IIFE.  
- On render: if `lastRealized !== null && realized > lastRealized`, add class `savings-bump` on the hero.  
- After paint, `requestAnimationFrame` / `setTimeout` ~450ms then remove class (or rely on `animationend`).  
- First paint after load: **no** bump; only set `lastRealized = realized`.  
- Then always `lastRealized = realized` at end of render path.

### G. Usage row + sparkline (exact UX)

Each user row:

- Label left: name  
- Label right: `~{credits}cr / {weeklyQuota} ({pct}%)` where `credits = Math.round(predictedUsagePct * weeklyQuota)`, `pct = Math.round(predictedUsagePct * 100)`  
- Bar: existing `.usage-track` / `.usage-fill`, `.hot` when `pct > 85`  
- Sparkline: inline SVG **before** or beside the bar, class `sparkline`

Sparkline algorithm:

- `viewBox="0 0 72 20"`, width 72, height 20  
- Map `usageHistory` to points; x equally spaced; y = padded invert of min–max normalize into y∈[2,18]  
- If `max === min`, draw horizontal line at y=10  
- `<polyline fill="none" stroke-width="1.5" stroke="{accent|#e8ff2b or hot error color}" points="..." />`  
- Hot stroke when `predictedUsagePct > 0.85`, else `#e8ff2b` (or `currentColor` with CSS)

### H. CSS additions only

Append to `styles.css` (do not restyle Market/Degen):

```css
.savings-sub { /* muted, 11px, margin under hero */ }
.savings-bump { animation: savings-bump 420ms ease-out; }
@keyframes savings-bump { /* brief scale 1→1.04→1 and/or brightness pulse */ }
.sparkline { display: block; width: 72px; height: 20px; flex-shrink: 0; }
```

Adjust `.usage-row` / label layout with flex if needed so sparkline + bar fit a narrow sidebar. Prefer minimal churn.

### I. Stretch: simulate week (only after 1–4)

`POST /team/simulate-week` inside FEATURE 2:

- For each user, generate 7 new daily points: for each of the next 7 calendar days after “today”, use that day’s weekday/weekend bucket daily average × `(0.9 + (hash % 21) / 100)` where `hash` is a tiny deterministic function of `(user.id, dayOffset)` — **no `Math.random()`** so demos are repeatable.  
- Append 7 days, drop oldest until `usageHistory.length === 14`.  
- Do **not** reset or change `realizedSavings`.  
- Call `finishMutation("Fast-forwarded mock usage one week.")` and `response.json({ ok: true })`.  
- Team tab: button `Run week simulation` → `window.api("/team/simulate-week", {})`.

If time is short after must-ship, skip stretch entirely rather than half-shipping it.

### J. Modularity / teammate isolation

- Build only on Stage 0 `main`. Do not import or call Market/Degen APIs.  
- Do not modify `finishMutation` / `broadcast` / WS handlers unless you introduced a bug inside FEATURE 2.  
- Keep `recomputeDerivedState` defined inside FEATURE 2 (Stage 0 already calls it from outside — that is fine).  
- `realizedSavings` is additive; other tabs may ignore it.  
- Stay inside FEATURE 2 markers so merge conflicts stay local.

---

## Implementation sequence

1. `git checkout main && git pull && git checkout -b feat/team` (if branch missing).  
2. Types + seed: `realizedSavings`.  
3. Server FEATURE 2: weekday `projectedWeeklyUsage`, narrative `buildSuggestions`, accumulate on accept, event text.  
4. `team.js` + CSS: hero, cards, usage+credits+sparklines, bump.  
5. Run verification checklist below.  
6. Stretch only if green.

Match existing style: terse vanilla JS, template literals, `data-*` delegation, VS Code CSS variables, accent `#e8ff2b`. Errors via existing `window.api` toast path.

---

## Verification (Seb-scoped — run these; do not rely on full e2e)

No new test framework. Server: `cd server && npx tsx src/index.ts`.

### Static

```bash
cd server && npm run typecheck
cd ../extension && npx tsc
```

### B. State shape + narrative

```bash
curl -s http://localhost:4747/state | python3 -c '
import json,sys
s=json.load(sys.stdin)
assert s.get("realizedSavings", None) == 0
assert s["suggestions"], "expected seed suggestions"
users={u["id"]:u for u in s["users"]}
assert users["u7"]["predictedUsagePct"] > 0.85, users["u7"]["predictedUsagePct"]
assert users["u6"]["predictedUsagePct"] < 0.6, users["u6"]["predictedUsagePct"]
for sug in s["suggestions"]:
    assert "Without this move" in sug["reason"]
    assert "overage" in sug["reason"]
    assert "Team saves" in sug["reason"]
    expected = round(sug["amount"] * 0.8, 2)
    assert abs(sug["projectedSavings"] - expected) < 0.011, (sug, expected)
print("OK", len(s["suggestions"]), "suggestions")
print(s["suggestions"][0]["reason"])
'
```

### C. Accept + cumulative

```bash
SID=$(curl -s http://localhost:4747/state | python3 -c 'import json,sys; print(json.load(sys.stdin)["suggestions"][0]["id"])')
BEFORE=$(curl -s http://localhost:4747/state)
curl -s -X POST "http://localhost:4747/suggestions/$SID/accept" -H 'content-type: application/json' -d '{}'
curl -s http://localhost:4747/state | python3 -c '
import json,sys
s=json.load(sys.stdin)
assert s["realizedSavings"] > 0
print("OK realizedSavings=", s["realizedSavings"])
'
# 404 path
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:4747/suggestions/does-not-exist/accept -H 'content-type: application/json' -d '{}'
```

Also assert the accepted transfer moved credits: parse `BEFORE` for the suggestion’s from/to/amount and confirm balances changed by ±amount.

### D. WS (optional but recommended)

One `ws` client connected; fire accept; confirm an `event` message and a `state` with `realizedSavings > 0`.

### E. Team tab manual (one Extension Host)

1. Hero `$0.00` realized on fresh seed; on-table subtitle non-zero if suggestions exist.  
2. Card reason matches counterfactual template.  
3. Rows show `~Xcr / quota (Y%)` + SVG sparkline; Burnzilla hot.  
4. Accept → realized increases, bump once, toast shows; reconnect still shows server `realizedSavings`.  
5. Broken suggestion id → error toast (not silent).

### F. Do not block on

Full trade↔coinflip↔spectate multi-laptop loop (integration after merge). One smoke trade only if you fear you broke `finishMutation`.

### G. Stretch only

```bash
curl -s -X POST http://localhost:4747/team/simulate-week -H 'content-type: application/json' -d '{}'
curl -s http://localhost:4747/state | python3 -c '
import json,sys
s=json.load(sys.stdin)
assert all(len(u["usageHistory"])==14 for u in s["users"])
print("OK simulate-week", "realizedSavings", s["realizedSavings"])
'
```

---

## Done criteria (summary for the agent)

- [ ] `feat/team` branch with only owned files changed (plus the one types field + seed)  
- [ ] Weekday-aware forecast per rules A–B  
- [ ] Narrative reasons per D  
- [ ] `realizedSavings` wired per E; hero/on-table/bump per F  
- [ ] Sparklines + credits rows per G–H  
- [ ] Verification B–E pass  
- [ ] Stretch G optional  
- [ ] Final summary: files touched, endpoints changed, types change, exactly how you verified  

When finished, do **not** open a PR unless asked. Do **not** merge to `main`.
---

## Reference: current Stage 0 anchors

- FEATURE 2 starts at `projectedWeeklyUsage` / `buildSuggestions` / `recomputeDerivedState` / `POST /suggestions/:id/accept` in `server/src/index.ts`.  
- Team UI is `extension/media/team.js` registering `window.renderers.team`.  
- Shell helpers: `window.api`, `window.toast`, `window.userById`, `window.escapeHtml`, `window.currentUserId`.  
- Demo users: `u6` Credit Hoarder (surplus), `u7` Burnzilla (deficit).  

End of prompt.
