# Compute Exchange

Compute Exchange is a VS Code sidebar and shared in-memory server for reallocating a team's unused AI budget. It forecasts usage, lists surplus allocation, proposes cost-saving team moves, and adds a virtual coinflip for demo-day chaos.

> **Compute Exchange never transfers vendor credits between accounts—it is an internal budget-reallocation layer over an organization's existing spend.** Stage 0 uses simulated, in-memory allocation units. There are no vendor credentials, payments, cash-outs, or external provider calls.

Dollar values are modeled cost-avoidance and internal chargeback estimates, not money moving through the application. Coinflip stakes are virtual demo units with no cash value or redemption path.

## Run locally

Requirements: Node.js 20+, npm, and VS Code.

Start the shared server:

```bash
cd server
npm install
npx tsx src/index.ts
```

The HTTP and WebSocket server listens at `http://localhost:4747`. Open `http://localhost:4747/spectate` for the live event feed.

In another terminal, compile the extension:

```bash
cd extension
npm install
npx tsc
```

Open the repository root in VS Code and press `F5`, then choose **Run Compute Exchange Extension** if prompted. In the Extension Development Host, open the Compute Exchange icon in the Activity Bar.

## Use one server from multiple laptops

1. Start the server on one laptop and find that laptop's LAN IP.
2. Make port `4747` reachable on the local network.
3. On each client, set `computeExchange.serverUrl` to `http://<server-lan-ip>:4747`.
4. Give each laptop a different seeded identity with `computeExchange.userId` (`u1` through `u10`).

All clients receive the same full state after each mutation. An event message is broadcast immediately before that state.

## Team handoff

Stage 0 is complete. See [`TEAM_HANDOFF.md`](./TEAM_HANDOFF.md) for the remaining feature tracks, shared-polish checklist, merge order, final acceptance gate, and demo script. The full copy/paste prompts for each teammate remain in [`codex-prompt-pack.md`](./codex-prompt-pack.md).

## Stage 0 API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/state` | Full exchange state |
| `POST` | `/listings` | Escrow and list surplus allocation |
| `POST` | `/trades` | Fill a listing and reallocate its credits |
| `GET` | `/price-suggestion/:userId` | Forecast-derived amount and chargeback rate |
| `POST` | `/suggestions/:id/accept` | Accept an internal team transfer |
| `POST` | `/bets` | Escrow a virtual coinflip challenge |
| `POST` | `/bets/:id/accept` | Accept and settle a coinflip |
| `GET` | `/spectate` | Bare WebSocket-driven event feed |

Server errors use a `4xx` response with `{ "error": "..." }`.

## File ownership

| Area | Owner |
| --- | --- |
| `extension/media/market.js` and marketplace server section | Liam |
| `extension/media/team.js` and forecast/suggestions server section | Seb |
| `extension/media/bet.js` and bets server section | D |
| Extension shell, `extension/src/`, and `extension/media/app.js` | A |
| `/spectate` and demo integration | E |
| `shared/types.ts` | PR-only shared contract |

Stage 1 branches: `feat/market`, `feat/team`, `feat/degen`, and `feat/spectate`. Keep `main` runnable and stay inside the marked feature sections in `server/src/index.ts`.

## Roadmap: platform-owned API routing

A separately reviewed future product could hold provider API accounts itself and route model requests through a customer application without sharing provider accounts or keys. That is roadmap material only—not Stage 0. Before building it, the team must validate each provider agreement plus unit economics, refunds and payments compliance, privacy, moderation, geographic availability, and abuse controls. The repository does not claim that this model has provider or legal approval; consult the applicable terms and qualified counsel. See the current [OpenAI Services Agreement](https://openai.com/policies/services-agreement/) for the distinction between customer applications and prohibited account/API-key transfers.
