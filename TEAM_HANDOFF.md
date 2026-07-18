# Team Handoff — What Remains

Stage 0 is complete and `main` is the working integration baseline. The remaining job is one real usage-to-allocation loop, feature depth, shared polish, deployment, and a repeatable demo.

In this project, “models” means deterministic server-side forecasting, pricing, and matching logic. Do not add OpenAI, Anthropic, Cursor, or other provider API calls; the demo must remain an in-memory internal-allocation simulation.

## Start here

Each teammate should pull the latest `main`, create only their assigned branch, and paste the matching feature prompt from [`codex-prompt-pack.md`](./codex-prompt-pack.md) into Codex.

```bash
git clone https://github.com/surajrdy/ramp.git
cd ramp
git checkout -b feat/integration-ui
```

Seb substitutes `feat/team`; Liam and Daniel both use `feat/degen` and coordinate before pushing. If the repository is already cloned, run `git checkout main && git pull` before creating the branch.

## Parallel feature tracks

| Owner | Branch | Must ship before merge | Stretch only after must-ship work |
| --- | --- | --- | --- |
| Suraj | `feat/integration-ui` | [`USAGE_TRANSFER_SPEC.md`](./USAGE_TRANSFER_SPEC.md), Market, shared iPhone-like UI primitives, reset, spectator/deploy, final integration | Provider-usage adapter design only; no live provider dependency |
| Seb | `feat/team` | Weekday-aware forecast, projected usage in credits, narrative counterfactuals, realized-savings headline, 14-day sparklines | Seven-day mock simulation |
| Liam + Daniel | `feat/degen` | Coinflip suspense/confetti, targeted challenges, winner/loser leaderboard, spectator-friendly result events, at least one extra virtual game | Five-minute mock usage race |

Feature owners stay inside their tab file and marked section of `server/src/index.ts`. Suraj owns Market, the extension shell, `app.js`, shared CSS, usage-demo endpoints, spectator/deploy, and final integration. Seb owns Team and forecast/suggestion logic. Liam and Daniel jointly own Degen and games. Any `shared/types.ts` change must be coordinated before editing so all branches use the same contract.

Suraj implements the exact seeded flow in [`USAGE_TRANSFER_SPEC.md`](./USAGE_TRANSFER_SPEC.md): a server-recorded agent burst changes demand, the model creates a recommendation, and accepting it transfers conserved internal allocation. All visual work follows [`UI_DIRECTION.md`](./UI_DIRECTION.md).

## Shared polish after features work

- Make loading, empty, disabled, error, and success states consistent across tabs.
- Keep the savings number visually dominant and label dollar figures as estimated cost avoidance.
- Use the existing VS Code theme variables and `#e8ff2b`; do not introduce React, a bundler, or UI dependencies.
- Keep button copy short, seller/user names obvious, and the current client’s identity visible.
- Make narrow-sidebar layouts usable and keep spectator text readable on a phone.
- Route every server error to a toast; never leave a failed click silent.
- Preserve the simulation framing: no vendor credentials, payments, cash-out, or redeemable gambling.

## Merge and integration order

1. Each feature branch pulls or rebases onto the latest `main` and reruns its own flow.
2. Merge `feat/team`, then `feat/degen`, resolving only the marked server sections each owner changed.
3. Rebase and merge `feat/integration-ui` last because it owns the shell and consumes the final state and events from every feature.
4. Freeze feature work after the first complete demo loop; only fix acceptance-breaking bugs afterward.

`main` must always start. Never merge a branch that breaks the Stage 0 trade or coinflip loop.

## Definition of done

- [ ] `cd server && npm install && npm run typecheck` passes.
- [ ] `cd extension && npm install && npx tsc` passes.
- [ ] The server starts cleanly with `npx tsx src/index.ts`.
- [ ] Two extension clients see the same trade in under one second.
- [ ] Accepting a team suggestion changes balances and the savings headline.
- [ ] A full coinflip opens, settles, pays exactly `2 × stake`, and broadcasts the result.
- [ ] Credits remain conserved across balances plus listing/bet escrow.
- [ ] Invalid actions return `4xx {error}` and appear as webview toasts.
- [ ] A `300cr` simulated workload changes Suraj's forecast, creates a recommendation, and broadcasts event then state to two clients in under one second.
- [ ] Accepting that recommendation moves the same number of credits out of the source and into Suraj without changing the conserved total.
- [ ] `/admin/reset` restores a repeatable seed state.
- [ ] Three extension clients and two spectator pages stay synchronized through trade → suggestion → coinflip.
- [ ] The public URL works over HTTPS and the extension automatically uses WSS.

## Final demo and pitch

Prepare one 60–90 second script: reset, run Suraj's `300cr` agent burst, show the forecast-created recommendation, apply the allocation, point to the changed balances and savings, buy a listed allocation on another laptop, run a Degen game, and show the spectator feed updating.

Use the core framing verbatim: “Compute Exchange never transfers vendor credits between accounts—it is an internal budget-reallocation layer over an organization’s existing spend.” Option B—the platform-owned provider proxy—is a roadmap slide only and must not become demo code.
