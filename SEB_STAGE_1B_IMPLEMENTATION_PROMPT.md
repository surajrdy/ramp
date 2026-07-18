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

## Clarifications (Seb Stage 1b) — resolved during design review

These refine A–J after checking the resolved rules against the real Stage 0 code and the actual seed math. They are law alongside A–J. Where they touch an existing section, the section letter is noted.

### C1. "Global index weights" means the original array position (refines B.2)

The recency weight is the sample's position in the **full 14-day `usageHistory` array** (`weight = index + 1`, range 1–14), **not** its position within its weekday/weekend bucket. Do **not** re-index each bucket from 0 — that produces different averages and is wrong.

Implement as a single pass: iterate `usageHistory` once, and for each element route `(Math.max(0, value), index + 1)` into either the weekday or weekend bucket. Then, per bucket, `dailyAvg = sum(value * weight) / sum(weight)`. Apply the B.3 empty-bucket fallback, then `projectedWeekly = 5 * weekdayDaily + 2 * weekendDaily`.

### C2. The seed produces exactly ONE suggestion — this is expected (refines C/F)

With this seed and the weekday-aware forecast, **u7/Burnzilla is the only deficit user (> 0.85)**. Greedy pairs it with the lowest-surplus source (u6/Credit Hoarder), consumes u7's entire need in one match, and stops. Verified across all 7 possible run days: u6 stays ≈ 0.13 (surplus), u7 stays 0.87–0.91 (deficit), and no borderline user (u2 0.72, u9 0.65, u10 0.66) ever crosses a threshold. So the suggestion set is deterministic regardless of demo date.

Concrete expected values on fresh seed:

- One suggestion: `Credit Hoarder → Burnzilla`, `amount = 504`, `projectedSavings = 403.20`.
- Hero on fresh seed: realized `$0.00`, on-table `$403.20/wk`.
- After one Accept: u7's `need` → 0, so the card **disappears**, on-table → `$0.00`, realized → `$403.20`, one bump.

Consequence: the "accepting again re-adds" clause (E/F.4) is **latent** — it will not fire on this seed because `need` reaches 0 after the single full transfer. Keep the clause implemented (do not special-case it away); it is simply not exercised here.

**Do not** widen the suggestion list by editing seed personalities — that file is shared demo state and out of Seb's lane (Seb may only add `realizedSavings: 0` to it). A richer multi-card list is a **proposal to the seed owner**, tracked in C10 below, not a change to make on `feat/team`.

### C3. Weekday classification is calendar-dependent but demo-safe (confirms A)

No action — recorded so it is not re-investigated. Because A overlays the **real** machine calendar onto seed data, bucket membership shifts with the run date, but the load-bearing thresholds (u6 surplus, u7 deficit) hold on every weekday. Safe to demo any day.

### C4. Credit display caps at quota for overage users (confirms B) — accepted

`displayCredits = Math.round(user.predictedUsagePct * user.weeklyQuota)` caps at `weeklyQuota` because `predictedUsagePct` is clamped to 1.0 in `recomputeDerivedState`. This is a non-issue for the seed (u7 projects 624 < 700). It only surfaces after `simulate-week` pushes someone > 100%, whose credit readout will then read exactly the quota. **Accepted as-is** — the overage magnitude already lives in the suggestion `reason` string (D). Do not un-clamp `predictedUsagePct`.

### C5. Accept flow: one accept → bump → card clears (refines E/F.5)

Intended UX: click Accept → realized increases once → hero bumps once → the card is gone on the next broadcast (per C2). Keep the existing `team.js` handler's `finally { button.disabled = false; }`. Do **not** add re-accept affordances or optimistic UI.

### C6. Accept mutation ordering (refines E)

In `POST /suggestions/:id/accept`, after the balance transfer:

1. Capture locals first: `amount`, `fromUser.name`, `toUser.name`, `suggestion.projectedSavings`.
2. `state.realizedSavings = round(state.realizedSavings + suggestion.projectedSavings, 2);`
3. Build the event string (it embeds the **new** `state.realizedSavings`).
4. Call `finishMutation(eventText)` last — its internal `recomputeDerivedState()` rebuilds `state.suggestions` **after** the string is built, so capturing locals in step 1 is required.

### C7. Unify the "hot" threshold (refines G)

Compute `const pct = Math.round(user.predictedUsagePct * 100)` once per row and drive **both** the usage bar `.hot` class **and** the sparkline hot stroke from `pct > 85`. Do not mix in a separate `predictedUsagePct > 0.85` test — the two disagree in the 85.1–85.4% band.

### C8. Deterministic hash for simulate-week (refines I)

Use, with no `Math.random()`:

```ts
const hash = [...user.id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) + dayOffset * 31;
const jitter = 0.9 + (hash % 21) / 100;              // 0.90 .. 1.10
const value = Math.round(bucketDailyAvg * jitter);    // integers, matching seed style
```

`bucketDailyAvg` is the weekday or weekend daily average (from the same C1 computation) selected by the **future** day's `getDay()`. Append 7 such values, drop oldest until `usageHistory.length === 14`. Do not touch `realizedSavings`.

### C9. `realizedSavings` and `/admin/reset` (confirms E/J) — no action

`/admin/reset` (FEATURE 4, owner A) re-assigns `state = createSeedState()`, and the new `realizedSavings: 0` field means reset zeroes it automatically. Desirable for repeatable demos. **Do not** edit FEATURE 4 to achieve this.

### C10. Proposal to the seed owner (NOT a `feat/team` change)

Optional, hand off separately: to make "Recommended moves" a multi-card list, add a **second** deficit user in `seed.ts` (a user whose weekday-aware forecast lands > 85% of quota with a below-forecast balance), or reduce u6's balance so it cannot cover u7's need alone (forcing a second surplus source into the match). This is a shared-seed change and must be made by the seed owner, not on `feat/team`.

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
