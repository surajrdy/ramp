# Usage-to-Allocation Demo Spec

## Decision

Stage 0.5 will demonstrate a **real internal allocation transfer**, driven by simulated usage demand. It will not transfer vendor service credits, keys, accounts, money, or model responses.

The proof for judges is a causal loop:

```text
simulated workload
        ↓
recorded demand changes
        ↓
forecast and deficit change
        ↓
optimizer proposes a move
        ↓
acceptance transfers conserved allocation
        ↓
every client receives event → full state
```

This is more than a UI animation: the server owns the usage mutation, forecast, recommendation, transfer, validation, escrow, and broadcasts.

## What the units mean

- `usageHistory` records normalized demand units observed by the demo.
- `User.balance` is the user's spendable internal allocation.
- Listings and team suggestions move that allocation between members of one organization.
- A listing price is modeled internal chargeback metadata. There is no second currency, payment, or seller cash-out.
- Recording usage does **not** subtract from `balance`. Demand is a meter; allocation is ledger inventory. Subtracting both would destroy credits and break conservation.

## One new endpoint

### `POST /usage/simulate`

Request:

```json
{
  "userId": "u3",
  "credits": 300
}
```

Validation, before any mutation:

- Body is an object.
- `userId` is a string for an existing user.
- `credits` is a positive integer no greater than that user's `weeklyQuota`.
- Invalid input returns `4xx` with `{ "error": "..." }`, changes no state, and sends no WebSocket message.

Successful mutation:

1. Add `credits` to the user's newest `usageHistory` sample.
2. Call the existing mutation finalizer so forecasts and suggestions recompute.
3. Broadcast `{type:"event"}` and then `{type:"state"}`.
4. Return:

```json
{
  "userId": "u3",
  "addedUsageCredits": 300,
  "currentDailyUsage": 349,
  "predictedUsagePct": 0.8987
}
```

The request and response can use server-local types. No `shared/types.ts` change is required.

## Deterministic demo loop

Use the seeded `u3` identity and reset or restart the server before each run.

1. Open two extension clients and one `/spectate` page.
2. Show D at about `43%` predicted usage with `340cr` spendable after seeded escrow.
3. Press **Run 300cr agent burst**. The UI calls `POST /usage/simulate`—there is no client-side forecast math.
4. D's latest usage sample changes from `49` to `349`; predicted usage rises to about `90%`.
5. The server creates a recommendation from Credit Hoarder to D for about `200cr`, with about `$160/wk` modeled savings.
6. Press **Apply move** in Team. The server moves the exact recommended allocation: Credit Hoarder's balance falls and D's rises by the same amount.
7. Show both other clients updating immediately and the spectator feed recording both events.

The accepted recommendation is the transfer. The workload is the demand signal that caused it. Dollar values remain cost-avoidance estimates.

## UI work owned by Suraj

- Add a compact **Demo workload** card to the Market/integration surface.
- Show the current identity, balance, forecast, and one primary **Run 300cr agent burst** button.
- Disable the button while the request is pending and surface every failure through the shared toast.
- After success, explain the next action: **Forecast changed—open Team to apply the allocation.**
- Do not locally patch state; wait for the WebSocket state broadcast.
- Add `POST /admin/reset` before live demos so this sequence is repeatable without restarting the process.

Seb owns the forecast and recommendation math. Suraj's usage endpoint supplies a new input and calls the existing recompute path; it must not duplicate or replace Seb's model.

## Acceptance

- Baseline total credits across balances plus open listing/bet escrow is recorded.
- `POST /usage/simulate` changes only the targeted usage sample and derived state; the conserved-credit total is unchanged.
- Two WebSocket clients each receive the usage event before the updated state in under one second.
- The seeded `+300cr` burst moves `u3` above the deficit threshold and creates a recommendation.
- Accepting that recommendation decreases the source balance and increases the destination balance by exactly the same amount.
- The savings headline changes from server-derived state.
- Reusing a stale suggestion fails with `4xx {error}` and changes no balance.
- Malformed, negative, fractional, oversized, and unknown-user usage requests fail without mutation or broadcast.
- Reset restores the seed state and the complete loop can run again.

## Optional post-hackathon adapter

A later, separately reviewed integration could normalize usage records from an organization's provider account into the same server-side demand event. If the platform ever routes model calls, it must hold provider credentials only on the server and enforce an organization's own project/user limits; it must never transfer provider credits or keys between accounts. Provider agreements, privacy, retention, moderation, abuse, payments, refunds, and unit economics must be reviewed before that work begins. The hackathon demo must not depend on it.
