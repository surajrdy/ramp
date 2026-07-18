# Team Handoff — What Remains

Stage 0 is complete and `main` is the working integration baseline. The remaining job is feature depth, shared polish, deployment, and one repeatable demo loop.

In this project, “models” means deterministic server-side forecasting, pricing, and matching logic. Do not add OpenAI, Anthropic, Cursor, or other provider API calls; the demo must remain an in-memory internal-allocation simulation.

## Start here

Each teammate should pull the latest `main`, create only their assigned branch, and paste the matching feature prompt from [`codex-prompt-pack.md`](./codex-prompt-pack.md) into Codex.

```bash
git clone https://github.com/surajrdy/ramp.git
cd ramp
git checkout -b feat/market
```

Substitute `feat/team`, `feat/degen`, or `feat/spectate` as appropriate. If the repository is already cloned, run `git checkout main && git pull` before creating the branch.

## Parallel feature tracks

| Owner | Branch | Must ship before merge | Stretch only after must-ship work |
| --- | --- | --- | --- |
| Liam | `feat/market` | Discount-sorted order book, seller forecast context, listing cancellation/refund, editable surplus form, projected proceeds, last-five trade history | Next-week futures listing |
| Seb | `feat/team` | Weekday-aware forecast, projected usage in credits, narrative counterfactuals, realized-savings headline, 14-day sparklines | Seven-day mock simulation |
| D | `feat/degen` | Coinflip suspense/confetti, targeted challenges, winner/loser leaderboard, spectator-friendly result events | Five-minute mock usage race |
| A + E | `feat/spectate` | `PORT` support, tunnel/deploy instructions, three-column spectator page, `/admin/reset`, HTTPS/WSS smoke test | QR polish after the live dashboard works |

Feature owners stay inside their tab file and marked section of `server/src/index.ts`. A owns the extension shell, `app.js`, and shared CSS coordination. E owns spectator/demo integration. Any `shared/types.ts` change must be coordinated before editing so all branches use the same contract.

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
2. Merge `feat/market`, then `feat/team`, then `feat/degen`, resolving only the marked server sections each owner changed.
3. Merge `feat/spectate` last because it consumes the final state and events from every feature.
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
- [ ] `/admin/reset` restores a repeatable seed state.
- [ ] Three extension clients and two spectator pages stay synchronized through trade → suggestion → coinflip.
- [ ] The public URL works over HTTPS and the extension automatically uses WSS.

## Final demo and pitch

Prepare one 60–90 second script: reset, show Burnzilla’s forecast, list/buy surplus on another laptop, accept the recommended team move, point to the changed savings number, run a coinflip, and show the spectator feed updating.

Use the core framing verbatim: “Compute Exchange never transfers vendor credits between accounts—it is an internal budget-reallocation layer over an organization’s existing spend.” Option B—the platform-owned provider proxy—is a roadmap slide only and must not become demo code.
