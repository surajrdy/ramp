# AGENTS.md — rules for every Codex session in this repo

Read SYSTEM_DESIGN.md first. It is canonical. If a request conflicts with it, flag the conflict instead of silently deviating.

## Hard constraints
- Webview is plain HTML/JS/CSS in `extension/media/`. NO React, NO bundler, NO npm packages in the webview. Extension host compiles with plain `tsc`.
- Server state is in-memory only. NO database, NO ORM, NO file persistence.
- All business logic (pricing, forecasting, matching, settlement, escrow) lives server-side. Webview tabs only render state and call endpoints.
- Every server mutation must: validate → mutate → recompute forecast + suggestions → broadcast `{type:"event"}` then `{type:"state"}` to all WS clients.
- Credits are conserved (see invariants in SYSTEM_DESIGN.md). Reject operations that would make a balance negative.
- Do not add dependencies beyond: express, cors, ws, tsx, typescript, @types/*. Anything else needs a stated reason in your summary.

## File ownership — stay in your lane
- `shared/types.ts` — do NOT edit unless the task explicitly says so; propose changes in your summary instead.
- `extension/media/market.js` + marketplace section of `server/src/index.ts` — Liam's sessions only.
- `extension/media/team.js` + forecast/suggestions section — Seb's sessions only.
- `extension/media/bet.js` + bets section — D's sessions only.
- `extension/src/`, `extension/media/app.js`, `/spectate`, deploy — A/E sessions only.
- Server sections are marked with `// ===== FEATURE N =====` comments. Never edit outside your feature's section except to fix a bug you introduced.
- Keep each tab's `window.renderers.<tab> = (state) => {...}` registration intact — it is the only shell↔tab contract.

## Working style
- This is a hackathon with a 3:00 PM hard cutoff. Prefer the smallest change that works. No speculative abstraction, no config systems, no test frameworks. Manual verification only.
- Stretch goals in a prompt are gated behind finishing the numbered items first. Do them in order.
- `main` must always run. Before finishing any task, verify: server starts clean with `npx tsx src/index.ts`; extension compiles with `npx tsc`; the acceptance loop still passes (two clients sync a trade in under 1s; a full coinflip round settles and broadcasts).
- Match the existing style: VS Code CSS variables for theming, accent `#e8ff2b`, terse vanilla JS, template-literal rendering, event delegation via `data-*` attributes.
- Error handling: return 4xx + `{error: string}` from the server; surface failures in the webview as a toast, never a silent no-op. Never crash the server process on bad input.

## When done
Summarize: files touched, endpoints added/changed, any `shared/types.ts` change you want to propose, and exactly how you verified the acceptance loop.
