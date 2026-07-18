import http from "node:http";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { WebSocket, WebSocketServer } from "ws";
import type {
  Bet,
  ExchangeState,
  Listing,
  TeamSuggestion,
  Trade,
  User,
  WsMessage,
} from "../../shared/types.js";
import { createSeedState } from "./seed.js";

const PORT = 4747;
const OVERAGE_RATE = 1.5;
const INTERNAL_RATE = 0.7;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json({ limit: "32kb" }));

let state: ExchangeState = createSeedState();
let nextListingId = state.listings.length + 1;
let nextTradeId = 1;
let nextBetId = 1;

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isUnitPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1;
}

function userById(id: string): User | undefined {
  return state.users.find((user) => user.id === id);
}

function sendError(response: Response, status: number, error: string): void {
  response.status(status).json({ error });
}

function broadcast(message: WsMessage): void {
  const encoded = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(encoded);
    }
  }
}

function finishMutation(eventText: string): void {
  recomputeDerivedState();
  broadcast({ type: "event", text: eventText });
  broadcast({ type: "state", state });
}

wss.on("connection", (socket) => {
  recomputeDerivedState();
  socket.send(JSON.stringify({ type: "state", state } satisfies WsMessage));
});

app.get("/state", (_request, response) => {
  recomputeDerivedState();
  response.json(state);
});

// ===== FEATURE 1: MARKETPLACE (Suraj) =====

function priceSuggestion(user: User): { amount: number; pricePerCredit: number } {
  const surplusPct = Math.max(0, 0.9 - user.predictedUsagePct);
  const amount = Math.floor(Math.min(user.balance, (user.weeklyQuota * surplusPct) / 2));
  const pricePerCredit = round(Math.max(0.3, 1 - surplusPct));
  return { amount, pricePerCredit };
}

app.get("/price-suggestion/:userId", (request, response) => {
  recomputeDerivedState();
  const user = userById(request.params.userId);
  if (!user) {
    sendError(response, 404, "User not found");
    return;
  }
  response.json(priceSuggestion(user));
});

app.post("/listings", (request, response) => {
  if (!isRecord(request.body)) {
    sendError(response, 400, "Request body must be an object");
    return;
  }

  const { sellerId, amount, pricePerCredit } = request.body;
  if (typeof sellerId !== "string") {
    sendError(response, 400, "sellerId is required");
    return;
  }
  if (!isPositiveInteger(amount)) {
    sendError(response, 400, "amount must be a positive integer");
    return;
  }
  if (!isUnitPrice(pricePerCredit)) {
    sendError(response, 400, "pricePerCredit must be greater than 0 and at most 1");
    return;
  }

  const seller = userById(sellerId);
  if (!seller) {
    sendError(response, 404, "Seller not found");
    return;
  }
  if (seller.balance < amount) {
    sendError(response, 409, "Seller does not have enough spendable credits");
    return;
  }

  const listing: Listing = {
    id: `listing-${nextListingId++}`,
    sellerId,
    amount,
    pricePerCredit: round(pricePerCredit),
    createdAt: new Date().toISOString(),
    status: "open",
  };
  seller.balance -= amount;
  state.listings.push(listing);
  finishMutation(`${seller.name} listed ${amount} internal credits at ${listing.pricePerCredit.toFixed(2)}x chargeback.`);
  response.status(201).json(listing);
});

app.post("/trades", (request, response) => {
  if (!isRecord(request.body)) {
    sendError(response, 400, "Request body must be an object");
    return;
  }

  const { listingId, buyerId } = request.body;
  if (typeof listingId !== "string" || typeof buyerId !== "string") {
    sendError(response, 400, "listingId and buyerId are required");
    return;
  }

  const listing = state.listings.find((candidate) => candidate.id === listingId);
  if (!listing) {
    sendError(response, 404, "Listing not found");
    return;
  }
  if (listing.status !== "open") {
    sendError(response, 409, "Listing is no longer open");
    return;
  }

  const buyer = userById(buyerId);
  const seller = userById(listing.sellerId);
  if (!buyer || !seller) {
    sendError(response, 404, "Buyer or seller not found");
    return;
  }
  if (buyer.id === seller.id) {
    sendError(response, 409, "You cannot buy your own listing");
    return;
  }

  const trade: Trade = {
    id: `trade-${nextTradeId++}`,
    listingId: listing.id,
    buyerId: buyer.id,
    sellerId: seller.id,
    amount: listing.amount,
    total: round(listing.amount * listing.pricePerCredit),
    ts: new Date().toISOString(),
  };
  listing.status = "filled";
  buyer.balance += listing.amount;
  state.trades.push(trade);
  finishMutation(`${buyer.name} reallocated ${listing.amount} credits from ${seller.name} at ${listing.pricePerCredit.toFixed(2)}x.`);
  response.status(201).json(trade);
});

// ===== FEATURE 2: FORECAST + TEAM SUGGESTIONS (Seb) =====

function projectedWeeklyUsage(user: User): number {
  const weighted = user.usageHistory.reduce(
    (accumulator, usage, index) => {
      const weight = index + 1;
      return { total: accumulator.total + Math.max(0, usage) * weight, weights: accumulator.weights + weight };
    },
    { total: 0, weights: 0 },
  );
  return weighted.weights === 0 ? 0 : (weighted.total / weighted.weights) * 7;
}

function buildSuggestions(): TeamSuggestion[] {
  const sources = state.users
    .filter((user) => user.predictedUsagePct < 0.6)
    .map((user) => ({ user, remaining: Math.max(0, Math.floor(user.balance - projectedWeeklyUsage(user))) }))
    .filter((source) => source.remaining > 0)
    .sort((left, right) => left.user.predictedUsagePct - right.user.predictedUsagePct);

  const deficits = state.users
    .filter((user) => user.predictedUsagePct > 0.85)
    .map((user) => ({ user, remaining: Math.max(0, Math.ceil(projectedWeeklyUsage(user) - user.balance)) }))
    .filter((deficit) => deficit.remaining > 0)
    .sort((left, right) => right.user.predictedUsagePct - left.user.predictedUsagePct);

  const suggestions: TeamSuggestion[] = [];
  let sourceIndex = 0;
  let deficitIndex = 0;
  while (sourceIndex < sources.length && deficitIndex < deficits.length) {
    const source = sources[sourceIndex];
    const deficit = deficits[deficitIndex];
    const amount = Math.min(source.remaining, deficit.remaining);
    if (amount > 0) {
      suggestions.push({
        id: `suggestion-${source.user.id}-${deficit.user.id}`,
        fromUserId: source.user.id,
        toUserId: deficit.user.id,
        amount,
        projectedSavings: round(amount * (OVERAGE_RATE - INTERNAL_RATE)),
        reason: `${source.user.name} has forecast surplus while ${deficit.user.name} is on track to exceed available allocation.`,
      });
      source.remaining -= amount;
      deficit.remaining -= amount;
    }
    if (source.remaining === 0) sourceIndex += 1;
    if (deficit.remaining === 0) deficitIndex += 1;
  }
  return suggestions;
}

function recomputeDerivedState(): void {
  for (const user of state.users) {
    const projected = projectedWeeklyUsage(user);
    user.predictedUsagePct = round(Math.min(1, Math.max(0, projected / user.weeklyQuota)), 4);
  }
  state.suggestions = buildSuggestions();
}

app.post("/suggestions/:id/accept", (request, response) => {
  recomputeDerivedState();
  const suggestion = state.suggestions.find((candidate) => candidate.id === request.params.id);
  if (!suggestion) {
    sendError(response, 404, "Suggestion not found or no longer available");
    return;
  }

  const fromUser = userById(suggestion.fromUserId);
  const toUser = userById(suggestion.toUserId);
  if (!fromUser || !toUser) {
    sendError(response, 404, "Suggestion users not found");
    return;
  }
  if (fromUser.balance < suggestion.amount) {
    sendError(response, 409, "Source user no longer has enough spendable credits");
    return;
  }

  fromUser.balance -= suggestion.amount;
  toUser.balance += suggestion.amount;
  finishMutation(`${suggestion.amount} credits moved from ${fromUser.name} to ${toUser.name}, avoiding an estimated $${suggestion.projectedSavings.toFixed(2)}/wk.`);
  response.json({ accepted: suggestion });
});

// ===== FEATURE 3: DEGEN COINFLIP (Liam + Daniel) =====

app.post("/bets", (request, response) => {
  if (!isRecord(request.body)) {
    sendError(response, 400, "Request body must be an object");
    return;
  }

  const { challengerId, stake, opponentId } = request.body;
  if (typeof challengerId !== "string") {
    sendError(response, 400, "challengerId is required");
    return;
  }
  if (!isPositiveInteger(stake)) {
    sendError(response, 400, "stake must be a positive integer");
    return;
  }
  if (opponentId !== undefined && typeof opponentId !== "string") {
    sendError(response, 400, "opponentId must be a user ID");
    return;
  }

  const challenger = userById(challengerId);
  if (!challenger) {
    sendError(response, 404, "Challenger not found");
    return;
  }
  if (challenger.balance < stake) {
    sendError(response, 409, "Challenger does not have enough spendable credits");
    return;
  }

  const opponent = typeof opponentId === "string" ? userById(opponentId) : undefined;
  if (typeof opponentId === "string" && !opponent) {
    sendError(response, 404, "Opponent not found");
    return;
  }
  if (opponent?.id === challenger.id) {
    sendError(response, 409, "You cannot challenge yourself");
    return;
  }

  const bet: Bet = {
    id: `bet-${nextBetId++}`,
    challengerId,
    ...(opponent ? { opponentId: opponent.id } : {}),
    stake,
    game: "coinflip",
    status: "open",
    ts: new Date().toISOString(),
  };
  challenger.balance -= stake;
  state.bets.push(bet);
  const target = opponent ? ` called out ${opponent.name}` : " opened a public challenge";
  finishMutation(`${challenger.name}${target} for a ${stake}-credit virtual coinflip.`);
  response.status(201).json(bet);
});

app.post("/bets/:id/accept", (request, response) => {
  if (!isRecord(request.body) || typeof request.body.userId !== "string") {
    sendError(response, 400, "userId is required");
    return;
  }

  const bet = state.bets.find((candidate) => candidate.id === request.params.id);
  if (!bet) {
    sendError(response, 404, "Bet not found");
    return;
  }
  if (bet.status !== "open") {
    sendError(response, 409, "Bet is already settled");
    return;
  }

  const challenger = userById(bet.challengerId);
  const acceptor = userById(request.body.userId);
  if (!challenger || !acceptor) {
    sendError(response, 404, "Challenger or acceptor not found");
    return;
  }
  if (acceptor.id === challenger.id) {
    sendError(response, 409, "You cannot accept your own challenge");
    return;
  }
  if (bet.opponentId && bet.opponentId !== acceptor.id) {
    sendError(response, 403, "This challenge is for another user");
    return;
  }
  if (acceptor.balance < bet.stake) {
    sendError(response, 409, "Acceptor does not have enough spendable credits");
    return;
  }

  acceptor.balance -= bet.stake;
  bet.opponentId = acceptor.id;
  bet.status = "settled";
  bet.winnerId = Math.random() < 0.5 ? challenger.id : acceptor.id;
  const winner = userById(bet.winnerId);
  if (!winner) {
    throw new Error("Coinflip winner disappeared");
  }
  winner.balance += bet.stake * 2;
  finishMutation(`${winner.name} won ${bet.stake * 2} virtual credits in a coinflip against ${winner.id === challenger.id ? acceptor.name : challenger.name}.`);
  response.json(bet);
});

// ===== FEATURE 4: INTEGRATION + SPECTATOR SHELL (Suraj) =====

app.get("/spectate", (_request, response) => {
  response.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Compute Exchange Live</title>
  <style>
    :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #090b0d; color: #f2f4f5; }
    body { margin: 0; padding: 32px; }
    main { width: min(900px, 100%); margin: 0 auto; }
    h1 { color: #e8ff2b; margin-bottom: 8px; }
    .sub { color: #a5adb5; max-width: 760px; line-height: 1.5; }
    #status { margin: 24px 0 12px; color: #e8ff2b; }
    #feed { display: grid; gap: 10px; }
    .event { border: 1px solid #31373d; border-left: 4px solid #e8ff2b; border-radius: 6px; padding: 14px; background: #12161a; }
    .time { color: #7f8992; font-size: 12px; margin-top: 6px; }
  </style>
</head>
<body>
  <main>
    <h1>COMPUTE EXCHANGE // LIVE</h1>
    <p class="sub">One team reallocating its own simulated AI budget. No vendor credits, credentials, money, or cash-out move through this demo.</p>
    <div id="status">connecting…</div>
    <div id="feed" aria-live="polite"></div>
  </main>
  <script>
    const status = document.getElementById("status");
    const feed = document.getElementById("feed");
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(protocol + "//" + location.host);
    socket.addEventListener("open", () => { status.textContent = "live"; });
    socket.addEventListener("close", () => { status.textContent = "disconnected — refresh to reconnect"; });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type !== "event") return;
      const item = document.createElement("div");
      item.className = "event";
      const text = document.createElement("div");
      text.textContent = message.text;
      const time = document.createElement("div");
      time.className = "time";
      time.textContent = new Date().toLocaleTimeString();
      item.append(text, time);
      feed.prepend(item);
    });
  </script>
</body>
</html>`);
});

app.use((_request, response) => {
  sendError(response, 404, "Route not found");
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  console.error(error);
  if (response.headersSent) return;
  sendError(response, 400, "Invalid request");
});

recomputeDerivedState();
server.listen(PORT, () => {
  console.log(`Compute Exchange server listening on http://localhost:${PORT}`);
});
