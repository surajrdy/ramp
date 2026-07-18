import http from "node:http";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { WebSocket, WebSocketServer } from "ws";
import type {
  BalloonGame,
  Bet,
  ExchangeState,
  Listing,
  TeamSuggestion,
  Trade,
  User,
  WheelGame,
  WsMessage,
} from "../../shared/types.js";
import { createSeedState } from "./seed.js";

const PORT = Number(process.env.PORT) || 4747;
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
let nextWheelGameId = 1;
let nextBalloonGameId = 1;

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

app.post("/listings/:id/cancel", (request, response) => {
  if (!isRecord(request.body) || typeof request.body.sellerId !== "string") {
    sendError(response, 400, "sellerId is required");
    return;
  }

  const listing = state.listings.find((candidate) => candidate.id === request.params.id);
  if (!listing) {
    sendError(response, 404, "Listing not found");
    return;
  }
  if (listing.status !== "open") {
    sendError(response, 409, "Only open listings can be cancelled");
    return;
  }
  if (listing.sellerId !== request.body.sellerId) {
    sendError(response, 403, "Only the listing owner can cancel it");
    return;
  }

  const seller = userById(listing.sellerId);
  if (!seller) {
    sendError(response, 404, "Seller not found");
    return;
  }

  listing.status = "cancelled";
  seller.balance += listing.amount;
  finishMutation(`${seller.name} cancelled a ${listing.amount}-credit listing; escrow was returned.`);
  response.json(listing);
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

  const total = round(listing.amount * listing.pricePerCredit);
  if (buyer.balance < total) {
    sendError(response, 409, "Buyer does not have enough internal credits for this offer");
    return;
  }

  const trade: Trade = {
    id: `trade-${nextTradeId++}`,
    listingId: listing.id,
    buyerId: buyer.id,
    sellerId: seller.id,
    amount: listing.amount,
    total,
    ts: new Date().toISOString(),
  };
  listing.status = "filled";
  buyer.balance -= total;
  seller.balance += total;
  buyer.balance += listing.amount;
  state.trades.push(trade);
  finishMutation(`${buyer.name} received ${listing.amount} credits from ${seller.name}; ${seller.name} earned ${total.toFixed(2)} flexible credits.`);
  response.status(201).json(trade);
});

// ===== FEATURE 2: FORECAST + TEAM SUGGESTIONS (Seb) =====

function usageBucketAverages(user: User): { weekdayDaily: number; weekendDaily: number } {
  const history = user.usageHistory;
  const n = history.length;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let weekdaySum = 0;
  let weekdayWeight = 0;
  let weekendSum = 0;
  let weekendWeight = 0;

  for (let index = 0; index < n; index++) {
    const daysAgo = n - 1 - index;
    const day = new Date(today);
    day.setDate(today.getDate() - daysAgo);
    const isWeekend = day.getDay() === 0 || day.getDay() === 6;
    const value = Math.max(0, history[index] ?? 0);
    const weight = index + 1;
    if (isWeekend) {
      weekendSum += value * weight;
      weekendWeight += weight;
    } else {
      weekdaySum += value * weight;
      weekdayWeight += weight;
    }
  }

  if (weekdayWeight === 0 && weekendWeight === 0) {
    return { weekdayDaily: 0, weekendDaily: 0 };
  }

  let weekdayDaily = weekdayWeight === 0 ? 0 : weekdaySum / weekdayWeight;
  let weekendDaily = weekendWeight === 0 ? 0 : weekendSum / weekendWeight;
  if (weekdayWeight === 0) weekdayDaily = weekendDaily;
  if (weekendWeight === 0) weekendDaily = weekdayDaily;
  return { weekdayDaily, weekendDaily };
}

function projectedWeeklyUsage(user: User): number {
  const { weekdayDaily, weekendDaily } = usageBucketAverages(user);
  return 5 * weekdayDaily + 2 * weekendDaily;
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
      const projectedSavings = round(amount * (OVERAGE_RATE - INTERNAL_RATE));
      suggestions.push({
        id: `suggestion-${source.user.id}-${deficit.user.id}`,
        fromUserId: source.user.id,
        toUserId: deficit.user.id,
        amount,
        projectedSavings,
        reason: `Without this move, ${deficit.user.name} pays overage on ~${amount}cr ($${(amount * OVERAGE_RATE).toFixed(2)}). Internal transfer costs $${(amount * INTERNAL_RATE).toFixed(2)}. Team saves $${projectedSavings.toFixed(2)}/wk.`,
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

app.post("/team/simulate-week", (_request, response) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const user of state.users) {
    const { weekdayDaily, weekendDaily } = usageBucketAverages(user);
    const appended: number[] = [];
    for (let dayOffset = 1; dayOffset <= 7; dayOffset++) {
      const day = new Date(today);
      day.setDate(today.getDate() + dayOffset);
      const isWeekend = day.getDay() === 0 || day.getDay() === 6;
      const bucketDailyAvg = isWeekend ? weekendDaily : weekdayDaily;
      const hash = [...user.id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) + dayOffset * 31;
      const jitter = 0.9 + (hash % 21) / 100;
      appended.push(Math.round(bucketDailyAvg * jitter));
    }
    user.usageHistory = [...user.usageHistory, ...appended].slice(-14);
  }

  finishMutation("Fast-forwarded mock usage one week.");
  response.json({ ok: true });
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

// ===== FEATURE 3b: WHEEL SPIN (D + Liam) =====

app.post("/games/wheel", (request, response) => {
  if (!isRecord(request.body)) {
    sendError(response, 400, "Request body must be an object");
    return;
  }

  const { creatorId, wager } = request.body;
  if (typeof creatorId !== "string") {
    sendError(response, 400, "creatorId is required");
    return;
  }
  if (!isPositiveInteger(wager)) {
    sendError(response, 400, "wager must be a positive integer");
    return;
  }

  const creator = userById(creatorId);
  if (!creator) {
    sendError(response, 404, "Creator not found");
    return;
  }
  if (creator.balance < wager) {
    sendError(response, 409, "Creator does not have enough spendable credits");
    return;
  }

  creator.balance -= wager;
  const game: WheelGame = {
    id: `wheel-${nextWheelGameId++}`,
    creatorId,
    players: [{ userId: creatorId, wager }],
    status: "waiting",
    totalPot: wager,
    ts: new Date().toISOString(),
  };
  state.wheelGames.push(game);
  finishMutation(`${creator.name} created a wheel spin game with a ${wager}-credit wager.`);
  response.status(201).json(game);
});

app.post("/games/wheel/:id/join", (request, response) => {
  if (!isRecord(request.body)) {
    sendError(response, 400, "Request body must be an object");
    return;
  }

  const { userId, wager } = request.body;
  if (typeof userId !== "string") {
    sendError(response, 400, "userId is required");
    return;
  }
  if (!isPositiveInteger(wager)) {
    sendError(response, 400, "wager must be a positive integer");
    return;
  }

  const game = state.wheelGames.find((g) => g.id === request.params.id);
  if (!game) {
    sendError(response, 404, "Wheel game not found");
    return;
  }
  if (game.status !== "waiting") {
    sendError(response, 409, "Game is no longer accepting players");
    return;
  }
  if (game.players.length >= 6) {
    sendError(response, 409, "Game is full (max 6 players)");
    return;
  }
  if (game.players.some((p) => p.userId === userId)) {
    sendError(response, 409, "You are already in this game");
    return;
  }

  const user = userById(userId);
  if (!user) {
    sendError(response, 404, "User not found");
    return;
  }
  if (user.balance < wager) {
    sendError(response, 409, "You do not have enough spendable credits");
    return;
  }

  user.balance -= wager;
  game.players.push({ userId, wager });
  game.totalPot += wager;
  finishMutation(`${user.name} joined ${userById(game.creatorId)?.name ?? "unknown"}'s wheel spin with a ${wager}-credit wager.`);
  response.json(game);
});

app.post("/games/wheel/:id/spin", (request, response) => {
  if (!isRecord(request.body)) {
    sendError(response, 400, "Request body must be an object");
    return;
  }

  const { userId } = request.body;
  if (typeof userId !== "string") {
    sendError(response, 400, "userId is required");
    return;
  }

  const game = state.wheelGames.find((g) => g.id === request.params.id);
  if (!game) {
    sendError(response, 404, "Wheel game not found");
    return;
  }
  if (game.status !== "waiting") {
    sendError(response, 409, "Game has already been spun");
    return;
  }
  if (userId !== game.creatorId) {
    sendError(response, 403, "Only the game creator can spin the wheel");
    return;
  }
  if (game.players.length < 2) {
    sendError(response, 400, "Need at least 2 players to spin");
    return;
  }

  // Weighted random: probability proportional to wager
  const roll = Math.random() * game.totalPot;
  let cumulative = 0;
  let winnerId = game.players[0].userId;
  for (const player of game.players) {
    cumulative += player.wager;
    if (roll < cumulative) {
      winnerId = player.userId;
      break;
    }
  }

  game.status = "settled";
  game.winnerId = winnerId;
  const winner = userById(winnerId);
  if (!winner) {
    throw new Error("Wheel winner disappeared");
  }
  winner.balance += game.totalPot;
  finishMutation(`${winner.name} won ${game.totalPot} virtual credits on the wheel spin!`);
  response.json(game);
});

// ===== PLAY PAGE (browser-based game client) =====

app.get("/play", (_request, response) => {
  const userOptions = state.users.map((u) => `<option value="${u.id}">${u.name} (${u.balance}cr)</option>`).join("");
  response.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Compute Exchange — Games</title>
  <style>
    :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #090b0d; color: #f2f4f5; --accent: #e8ff2b; --border: rgba(127,127,127,0.35); --surface: rgba(127,127,127,0.08); }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; }
    main { width: min(460px, 100%); margin: 0 auto; }
    h1 { color: var(--accent); font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 15px; margin: 18px 0 10px; }
    .eyebrow { color: var(--accent); font-size: 10px; font-weight: 800; letter-spacing: 0.12em; }
    .sub { color: #a5adb5; font-size: 12px; line-height: 1.45; margin: 0 0 16px; }
    .muted { color: #a5adb5; font-size: 11px; }
    button, input, select { font: inherit; }
    button { border: 1px solid transparent; border-radius: 4px; padding: 8px 12px; color: #f2f4f5; background: #2a2d32; cursor: pointer; }
    button:hover { background: #3a3d42; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    button.primary { color: #111; background: var(--accent); font-weight: 700; }
    button.primary:hover { background: #d9ef29; }
    button.danger { color: #fff; background: #c0392b; font-weight: 700; }
    button.danger:hover { background: #e74c3c; }
    input, select { border: 1px solid var(--border); border-radius: 4px; padding: 8px; color: #f2f4f5; background: #1e1e1e; }
    input { width: 80px; }
    select { width: 100%; margin-bottom: 12px; }
    .form-row { display: flex; gap: 8px; align-items: center; }
    .card-list { display: grid; gap: 8px; }
    .card { display: grid; gap: 7px; padding: 11px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }
    .card-title { font-weight: 750; }
    .empty { padding: 16px; border: 1px dashed var(--border); border-radius: 6px; color: #a5adb5; text-align: center; }
    .game-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 16px; }
    .game-tabs button { border: 0; border-radius: 4px; padding: 8px; font-weight: 600; }
    .game-tabs button.active { color: #111; background: var(--accent); font-weight: 800; }
    .wheel-wrap { position: relative; display: flex; justify-content: center; margin: 12px 0; }
    .wheel-pointer { position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 10px solid transparent; border-right: 10px solid transparent; border-top: 18px solid var(--accent); z-index: 2; filter: drop-shadow(0 2px 4px rgba(0,0,0,.4)); }
    .players { display: grid; gap: 6px; margin: 8px 0; }
    .player { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .swatch { width: 12px; height: 12px; border-radius: 2px; flex-shrink: 0; }
    .result { text-align: center; padding: 16px; border: 2px solid var(--accent); border-radius: 8px; background: var(--surface); margin: 12px 0; }
    .result .name { font-size: 20px; font-weight: 900; color: var(--accent); }
    .result .amt { font-size: 14px; margin-top: 4px; }
    .status { color: var(--accent); font-size: 11px; margin-bottom: 12px; }
    .toast-area { position: fixed; bottom: 10px; right: 10px; left: 10px; display: grid; gap: 6px; pointer-events: none; z-index: 10; }
    .toast { padding: 10px; border: 1px solid var(--accent); border-radius: 5px; background: #1e1e1e; box-shadow: 0 5px 20px rgba(0,0,0,.3); }
    .toast.error { border-color: #f14c4c; }
    .user-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 16px; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }
    .user-bar .bal { color: var(--accent); font-weight: 700; }
    .balloon-area { text-align: center; padding: 20px 0; }
    .balloon-emoji { font-size: 80px; transition: transform 0.3s ease; }
    .balloon-emoji.pumping { animation: pump 0.4s ease; }
    .balloon-emoji.popped { animation: explode 0.6s ease-out forwards; }
    @keyframes pump { 0% { transform: scale(var(--bs)); } 30% { transform: scale(calc(var(--bs)*1.2)) rotate(5deg); } 60% { transform: scale(calc(var(--bs)*1.15)) rotate(-3deg); } 100% { transform: scale(var(--bs)); } }
    @keyframes explode { 0% { transform: scale(var(--bs)); opacity:1; } 30% { transform: scale(calc(var(--bs)*1.5)); opacity:1; } 100% { transform: scale(calc(var(--bs)*2.5)); opacity:0; } }
    .pop-text { font-size: 48px; font-weight: 900; color: #ff6b6b; animation: popText 0.8s ease-out; }
    @keyframes popText { 0% { transform: scale(0.5); opacity:0; } 50% { transform: scale(1.3); opacity:1; } 100% { transform: scale(1); opacity:1; } }
    .balloon-shake { animation: shake 0.15s ease infinite; }
    @keyframes shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }
    .pump-bar { display: flex; gap: 4px; justify-content: center; margin: 12px 0; }
    .pump-bar button { min-width: 44px; }
    .credit-pools { display: flex; justify-content: space-between; gap: 12px; margin: 12px 0; }
    .credit-pool { flex: 1; text-align: center; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }
    .credit-pool .pool-name { font-size: 11px; color: #a5adb5; }
    .credit-pool .pool-val { font-size: 20px; font-weight: 900; color: var(--accent); }
    .credit-pool.opponent .pool-val { color: #ff6b6b; }
    .pump-count { font-size: 12px; color: #a5adb5; margin: 8px 0; }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">COMPUTE EXCHANGE</div>
    <h1>Degen Games</h1>
    <p class="sub">Simulated credits only. No cash value, redemption, or external effect.</p>
    <div class="status" id="status">connecting...</div>
    <label class="muted">Playing as:</label>
    <select id="user-select">${userOptions}</select>
    <div id="user-bar" class="user-bar"></div>
    <nav class="game-tabs">
      <button class="active" data-gtab="wheel">Wheel Spin</button>
      <button data-gtab="balloon">Balloon Pop</button>
    </nav>
    <div id="app"></div>
    <div class="toast-area" id="toasts"></div>
  </main>
  <script>
    const COLORS = ["#e8ff2b","#ff6b6b","#4ecdc4","#45b7d1","#f7dc6f","#bb8fce"];
    const SPIN_MS = 4000;
    let currentUserId = document.getElementById("user-select").value;
    let exchangeState = null;
    let activeAnim = null;
    let knownSettled = new Set();
    let currentGame = "wheel";

    document.getElementById("user-select").addEventListener("change", (e) => { currentUserId = e.target.value; render(); });

    // Game tab switching
    document.querySelectorAll("[data-gtab]").forEach((btn) => btn.addEventListener("click", () => {
      currentGame = btn.dataset.gtab;
      document.querySelectorAll("[data-gtab]").forEach((b) => b.classList.toggle("active", b === btn));
      activeAnim = null;
      render();
    }));

    async function api(path, body) {
      const res = await fetch(location.origin + path, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : {"Content-Type":"application/json"},
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast(data.error || "Request failed", "error"); throw new Error(data.error); }
      return data;
    }
    function toast(text, kind = "event") {
      const t = document.createElement("div"); t.className = "toast " + kind; t.textContent = text;
      document.getElementById("toasts").append(t); setTimeout(() => t.remove(), 4000);
    }
    function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
    function userById(id) { return exchangeState?.users?.find((u) => u.id === id); }

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(proto + "//" + location.host);
    ws.addEventListener("open", () => { document.getElementById("status").textContent = "live"; });
    ws.addEventListener("close", () => { document.getElementById("status").textContent = "disconnected — refresh"; });
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "event") toast(msg.text);
      if (msg.type === "state") { exchangeState = msg.state; render(); }
    });

    function render() {
      if (!exchangeState) return;
      const me = userById(currentUserId);
      document.getElementById("user-bar").innerHTML = me
        ? '<span>'+esc(me.name)+'</span><span class="bal">'+me.balance+' cr</span>'
        : '<span class="muted">unknown user</span>';
      const sel = document.getElementById("user-select");
      exchangeState.users.forEach((u) => {
        const opt = sel.querySelector('option[value="'+u.id+'"]');
        if (opt) opt.textContent = u.name + " (" + u.balance + "cr)";
      });
      if (currentGame === "wheel") renderWheel();
      else renderBalloon();
    }

    // ========== WHEEL SPIN ==========
    function renderWheel() {
      const games = exchangeState.wheelGames || [];
      const waiting = games.filter((g) => g.status === "waiting");
      const settled = games.filter((g) => g.status === "settled").slice(-5).reverse();
      for (const g of games) {
        if (g.status === "settled" && !knownSettled.has(g.id)) {
          knownSettled.add(g.id);
          if (g.players.some((p) => p.userId === currentUserId)) startSpin(g);
        }
      }
      if (activeAnim && !activeAnim.done) return;
      const myGame = waiting.find((g) => g.players.some((p) => p.userId === currentUserId));
      const app = document.getElementById("app");
      if (activeAnim && activeAnim.done) {
        const g = games.find((x) => x.id === activeAnim.gameId);
        if (g) { wResult(app, g); return; }
      }
      if (myGame) { wLobby(app, myGame); return; }
      wBrowse(app, waiting, settled);
    }
    function wBrowse(el, waiting, settled) {
      el.innerHTML = '<h2>Create a game</h2>'
        +'<form id="create-form" class="form-row" style="margin-bottom:20px">'
        +'<input name="wager" type="number" min="1" step="1" value="25">'
        +'<button class="primary" type="submit">Create Game</button></form>'
        +'<h2>Open games</h2><div class="card-list">'
        +(waiting.length ? waiting.map((g) => {
          const cr = userById(g.creatorId), names = g.players.map((p) => esc(userById(p.userId)?.name||"?")).join(", ");
          const inG = g.players.some((p) => p.userId === currentUserId);
          return '<article class="card"><div><div class="card-title">'+esc(cr?.name||"?")+"'s wheel &middot; "+g.totalPot+'cr pot</div>'
            +'<div class="muted">'+g.players.length+'/6: '+names+'</div></div>'
            +(inG?'<span class="muted">YOU\\'RE IN</span>':'<div class="form-row"><input type="number" min="1" step="1" value="25" class="join-wager" data-gid="'+g.id+'" style="width:70px"><button data-join="'+g.id+'">Join</button></div>')
            +'</article>';
        }).join(""):'<div class="empty">No open games. Create one!</div>')
        +'</div><h2>Recent results</h2><div class="card-list">'
        +(settled.length?settled.map((g) => {
          const w=userById(g.winnerId);
          return '<article class="card"><strong>'+esc(w?.name||"?")+" won "+g.totalPot+'cr</strong><span class="muted">'+g.players.length+' players</span></article>';
        }).join(""):'<div class="empty">No results yet.</div>')+'</div>';
    }
    function wLobby(el, game) {
      const isC = game.creatorId === currentUserId, can = isC && game.players.length >= 2;
      el.innerHTML = '<div class="eyebrow">GAME LOBBY</div><h2>Wheel Spin &middot; '+game.totalPot+'cr pot</h2>'
        +'<div class="wheel-wrap"><div class="wheel-pointer"></div><canvas id="wc" width="280" height="280"></canvas></div>'
        +'<div class="players">'+game.players.map((p,i)=>{
          const u=userById(p.userId), pct=game.totalPot>0?((p.wager/game.totalPot)*100).toFixed(1):0;
          return '<div class="player"><span class="swatch" style="background:'+COLORS[i%COLORS.length]+'"></span><strong>'+esc(u?.name||"?")+'</strong><span class="muted">'+p.wager+'cr ('+pct+'%)</span></div>';
        }).join("")+'</div>'
        +'<div class="muted" style="text-align:center">'+game.players.length+'/6 players</div>'
        +(isC?'<button class="primary" data-spin="'+game.id+'" style="width:100%;margin-top:8px" '+(can?"":"disabled")+'>'+(can?"SPIN THE WHEEL":"Need "+(2-game.players.length)+" more")+'</button>':'');
      drawWheel(document.getElementById("wc"), game, 0);
    }
    function wResult(el, game) {
      const w=userById(game.winnerId);
      el.innerHTML = '<div class="eyebrow">RESULT</div>'
        +'<div class="wheel-wrap"><div class="wheel-pointer"></div><canvas id="wc" width="280" height="280"></canvas></div>'
        +'<div class="result"><div class="name">'+esc(w?.name||"?")+" wins!</div>"+'<div class="amt">'+game.totalPot+'cr collected</div></div>'
        +'<div class="players">'+game.players.map((p,i)=>{
          const u=userById(p.userId), win=p.userId===game.winnerId;
          return '<div class="player" style="'+(win?"border:1px solid var(--accent);border-radius:4px;padding:4px 8px":"")+'"><span class="swatch" style="background:'+COLORS[i%COLORS.length]+'"></span><strong>'+esc(u?.name||"?")+(win?" ★":"")+'</strong><span class="muted">'+p.wager+'cr</span></div>';
        }).join("")+'</div><button data-dismiss style="width:100%;margin-top:8px">Back to games</button>';
      if (activeAnim) drawWheel(document.getElementById("wc"), game, activeAnim.targetAngle);
      else drawWheel(document.getElementById("wc"), game, 0);
    }
    function drawWheel(c, game, rot) {
      if (!c) return;
      const ctx=c.getContext("2d"), cx=c.width/2, cy=c.height/2, r=Math.min(cx,cy)-4;
      ctx.clearRect(0,0,c.width,c.height); ctx.save(); ctx.translate(cx,cy); ctx.rotate(rot);
      let a=0;
      for (let i=0;i<game.players.length;i++) {
        const p=game.players[i], sl=(p.wager/game.totalPot)*Math.PI*2;
        ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,r,a,a+sl); ctx.closePath();
        ctx.fillStyle=COLORS[i%COLORS.length]; ctx.fill();
        ctx.strokeStyle="rgba(0,0,0,0.3)"; ctx.lineWidth=2; ctx.stroke();
        if (sl>0.25) {
          const mid=a+sl/2, lr=r*0.6; ctx.save(); ctx.translate(Math.cos(mid)*lr,Math.sin(mid)*lr); ctx.rotate(mid+Math.PI/2);
          ctx.fillStyle="#111"; ctx.font="bold 11px monospace"; ctx.textAlign="center";
          ctx.fillText(userById(p.userId)?.name||"?",0,-6); ctx.font="10px monospace"; ctx.fillText(p.wager+"cr",0,7); ctx.restore();
        }
        a+=sl;
      }
      ctx.beginPath(); ctx.arc(0,0,14,0,Math.PI*2); ctx.fillStyle="#1e1e1e"; ctx.fill();
      ctx.strokeStyle="rgba(255,255,255,0.2)"; ctx.lineWidth=2; ctx.stroke(); ctx.restore();
    }
    function startSpin(game) {
      let ws2=0, wsl=0;
      for (const p of game.players) { const sl=(p.wager/game.totalPot)*Math.PI*2; if (p.userId===game.winnerId){wsl=sl;break;} ws2+=sl; }
      const offset=(Math.random()-0.5)*wsl*0.6; // land randomly within winner slice
      const base=-Math.PI/2-(ws2+wsl/2+offset), target=base+Math.PI*2*(5+Math.floor(Math.random()*3));
      activeAnim={gameId:game.id, start:performance.now(), targetAngle:target, done:false};
      const el=document.getElementById("app");
      el.innerHTML='<div class="eyebrow">SPINNING</div><h2>Wheel Spin &middot; '+game.totalPot+'cr pot</h2>'
        +'<div class="wheel-wrap"><div class="wheel-pointer"></div><canvas id="wc" width="280" height="280"></canvas></div>'
        +'<div class="players">'+game.players.map((p,i)=>'<div class="player"><span class="swatch" style="background:'+COLORS[i%COLORS.length]+'"></span><strong>'+esc(userById(p.userId)?.name||"?")+'</strong><span class="muted">'+p.wager+'cr</span></div>').join("")+'</div>';
      requestAnimationFrame(function tick(now) {
        if (!activeAnim||activeAnim.gameId!==game.id) return;
        const t=Math.min(1,(now-activeAnim.start)/SPIN_MS), eased=1-Math.pow(1-t,3);
        drawWheel(document.getElementById("wc"), game, target*eased);
        if (t<1) requestAnimationFrame(tick); else { activeAnim.done=true; render(); }
      });
    }

    // ========== BALLOON POP ==========
    let lastPumpCount = -1;
    let balloonAnimTimeout = null;
    let showingBalloonResult = null; // game ID of result being shown

    function renderBalloon() {
      const games = exchangeState.balloonGames || [];
      const waiting = games.filter((g) => g.status === "waiting");
      const playing = games.filter((g) => g.status === "playing");
      const ended = games.filter((g) => g.status === "popped" || g.status === "drained");
      const done = ended.slice(-5).reverse();
      const app = document.getElementById("app");

      // Am I in a game that just ended?
      const myEndedGame = ended.find((g) =>
        (g.player1 === currentUserId || g.player2 === currentUserId) && !showingBalloonResult);
      if (myEndedGame) {
        showingBalloonResult = myEndedGame.id;
        bEnded(app, myEndedGame);
        return;
      }
      if (showingBalloonResult) {
        const g = games.find((x) => x.id === showingBalloonResult);
        if (g) { bEnded(app, g); return; }
      }

      // Am I in an active game?
      const myGame = playing.find((g) => g.player1 === currentUserId || g.player2 === currentUserId)
        || waiting.find((g) => g.player1 === currentUserId);

      if (myGame && myGame.status === "playing") { bPlaying(app, myGame); return; }
      if (myGame && myGame.status === "waiting") { bWaiting(app, myGame); return; }
      bBrowse(app, waiting, done);
    }
    function bBrowse(el, waiting, done) {
      el.innerHTML = '<h2>Balloon Pop</h2>'
        +'<p class="muted">Take turns pumping. More pumps = steal more credits, but risk popping! Pop = you lose everything.</p>'
        +'<form id="balloon-create" class="form-row" style="margin-bottom:20px">'
        +'<input name="stake" type="number" min="1" step="1" value="50">'
        +'<button class="primary" type="submit">Create Game</button></form>'
        +'<h2>Open challenges</h2><div class="card-list">'
        +(waiting.length ? waiting.map((g) => {
          const cr=userById(g.player1);
          return '<article class="card"><div><div class="card-title">'+esc(cr?.name||"?")+'&apos;s balloon &middot; '+g.stake+'cr each</div>'
            +'<div class="muted">Waiting for opponent</div></div>'
            +(g.player1===currentUserId?'<span class="muted">YOUR GAME</span>':'<button data-bjoin="'+g.id+'">Accept</button>')
            +'</article>';
        }).join(""):'<div class="empty">No open balloon games.</div>')
        +'</div><h2>Recent results</h2><div class="card-list">'
        +(done.length?done.map((g) => {
          const w=userById(g.winnerId), l=userById(g.poppedBy||"");
          return '<article class="card"><strong>'+esc(w?.name||"?")+" won"+'</strong><span class="muted">'+(g.status==="popped"?esc(l?.name||"?")+" popped on pump #"+g.pumpCount:"drained")+'</span></article>';
        }).join(""):'<div class="empty">No results yet.</div>')+'</div>';
    }
    function bWaiting(el, game) {
      el.innerHTML = '<div class="eyebrow">YOUR GAME</div><h2>Balloon Pop &middot; '+game.stake+'cr each</h2>'
        +'<div class="balloon-area"><div class="balloon-emoji">🎈</div></div>'
        +'<div class="muted" style="text-align:center">Waiting for an opponent to accept...</div>';
    }
    function bPlaying(el, game) {
      const isP1 = game.player1 === currentUserId;
      const myTurn = game.currentTurn === currentUserId;
      const p1 = userById(game.player1), p2 = userById(game.player2);
      const myCredits = isP1 ? game.p1Credits : game.p2Credits;
      const theirCredits = isP1 ? game.p2Credits : game.p1Credits;
      const opponent = isP1 ? p2 : p1;
      const scale = 1 + game.pumpCount * 0.12;
      const risk = Math.min(90, Math.round(4*(game.pumpCount+1)));
      // Detect new pump for animation
      const justPumped = game.pumpCount !== lastPumpCount && lastPumpCount >= 0;
      lastPumpCount = game.pumpCount;
      const animClass = justPumped ? " pumping" : "";
      const shakeClass = risk > 50 ? " balloon-shake" : "";

      el.innerHTML = '<div class="eyebrow">'+(myTurn?"YOUR TURN":"OPPONENT\\'S TURN")+'</div>'
        +'<h2>Balloon Pop &middot; Pump #'+game.pumpCount+'</h2>'
        +'<div class="credit-pools">'
        +'<div class="credit-pool"><div class="pool-name">You</div><div class="pool-val">'+myCredits+'cr</div></div>'
        +'<div class="credit-pool opponent"><div class="pool-name">'+esc(opponent?.name||"?")+'</div><div class="pool-val">'+theirCredits+'cr</div></div>'
        +'</div>'
        +'<div class="balloon-area"><div class="balloon-emoji'+animClass+shakeClass+'" style="--bs:'+scale.toFixed(2)+';transform:scale('+scale.toFixed(2)+')">🎈</div></div>'
        +'<div class="pump-count">Pump count: '+game.pumpCount+' · Pop risk: '+risk+'%</div>'
        +(myTurn ? '<div class="muted" style="text-align:center;margin-bottom:8px">How many pumps? More = steal more, but riskier!</div>'
          +'<div class="pump-bar">'
          +'<button data-pump="1" data-pgame="'+game.id+'" class="primary">1</button>'
          +'<button data-pump="2" data-pgame="'+game.id+'" class="primary">2</button>'
          +'<button data-pump="3" data-pgame="'+game.id+'" class="primary">3</button>'
          +'<button data-pump="4" data-pgame="'+game.id+'" class="danger">4</button>'
          +'<button data-pump="5" data-pgame="'+game.id+'" class="danger">5</button>'
          +'</div>' : '<div class="muted" style="text-align:center">Waiting for '+esc(opponent?.name||"?")+" to pump...</div>");
      // Remove animation class after it plays
      if (justPumped) { clearTimeout(balloonAnimTimeout); balloonAnimTimeout = setTimeout(()=>{ const b=document.querySelector(".balloon-emoji"); if(b) b.classList.remove("pumping"); },450); }
    }
    function bEnded(el, game) {
      const w = userById(game.winnerId), loser = userById(game.poppedBy||"");
      const isWinner = game.winnerId === currentUserId;
      const scale = 1 + game.pumpCount * 0.12;
      el.innerHTML = '<div class="eyebrow">GAME OVER</div>'
        +'<h2>Balloon Pop Result</h2>'
        +'<div class="balloon-area">'
        +(game.status==="popped"
          ? '<div class="balloon-emoji popped" style="--bs:'+scale.toFixed(2)+'">🎈</div><div class="pop-text">POP!</div>'
          : '<div class="balloon-emoji" style="transform:scale(0.5);opacity:0.3">🎈</div><div class="pop-text" style="color:var(--accent)">DRAINED</div>')
        +'</div>'
        +'<div class="result"><div class="name">'+(isWinner?"You win!":esc(w?.name||"?")+" wins!")+'</div>'
        +'<div class="amt">'+(game.stake*2)+'cr collected</div>'
        +(game.status==="popped"?'<div class="muted" style="margin-top:8px">'+esc(loser?.name||"?")+" popped on pump #"+game.pumpCount+'</div>':'')
        +'</div>'
        +'<button data-bdismiss style="width:100%;margin-top:12px">Back to games</button>';
    }

    // ========== EVENT DELEGATION ==========
    document.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector("button"); if (!btn) return;
      btn.disabled = true;
      try {
        if (e.target.id === "create-form") {
          await api("/games/wheel", { creatorId: currentUserId, wager: Number(new FormData(e.target).get("wager")) });
        } else if (e.target.id === "balloon-create") {
          await api("/games/balloon", { creatorId: currentUserId, stake: Number(new FormData(e.target).get("stake")) });
        }
      } catch {} finally { btn.disabled = false; }
    });
    document.addEventListener("click", async (e) => {
      let btn;
      if ((btn = e.target.closest("[data-join]"))) {
        const gid=btn.dataset.join, input=document.querySelector('.join-wager[data-gid="'+gid+'"]');
        btn.disabled=true;
        try { await api("/games/wheel/"+encodeURIComponent(gid)+"/join",{userId:currentUserId,wager:input?Number(input.value):25}); } catch {} finally { btn.disabled=false; }
      }
      if ((btn = e.target.closest("[data-spin]"))) {
        btn.disabled=true;
        try { await api("/games/wheel/"+encodeURIComponent(btn.dataset.spin)+"/spin",{userId:currentUserId}); } catch {} finally { btn.disabled=false; }
      }
      if ((btn = e.target.closest("[data-dismiss]"))) { activeAnim=null; render(); }
      if ((btn = e.target.closest("[data-bdismiss]"))) { showingBalloonResult=null; lastPumpCount=-1; render(); }
      if ((btn = e.target.closest("[data-bjoin]"))) {
        btn.disabled=true;
        try { await api("/games/balloon/"+encodeURIComponent(btn.dataset.bjoin)+"/join",{userId:currentUserId}); } catch {} finally { btn.disabled=false; }
      }
      if ((btn = e.target.closest("[data-pump]"))) {
        const pumps=Number(btn.dataset.pump), gid=btn.dataset.pgame;
        document.querySelectorAll("[data-pump]").forEach((b)=>b.disabled=true);
        try { await api("/games/balloon/"+encodeURIComponent(gid)+"/inflate",{userId:currentUserId,pumps}); } catch {} finally { document.querySelectorAll("[data-pump]").forEach((b)=>b.disabled=false); }
      }
    });
  </script>
</body>
</html>`);
});

// ===== FEATURE 3c: BALLOON POP (Liam) =====

app.post("/games/balloon", (request, response) => {
  if (!isRecord(request.body)) {
    sendError(response, 400, "Request body must be an object");
    return;
  }

  const { creatorId, stake } = request.body;
  if (typeof creatorId !== "string") {
    sendError(response, 400, "creatorId is required");
    return;
  }
  if (!isPositiveInteger(stake)) {
    sendError(response, 400, "stake must be a positive integer");
    return;
  }

  const creator = userById(creatorId);
  if (!creator) {
    sendError(response, 404, "Creator not found");
    return;
  }
  if (creator.balance < stake) {
    sendError(response, 409, "Not enough spendable credits");
    return;
  }

  creator.balance -= stake;
  const game: BalloonGame = {
    id: `balloon-${nextBalloonGameId++}`,
    creatorId,
    player1: creatorId,
    stake,
    pumpCount: 0,
    p1Credits: stake,
    p2Credits: 0,
    currentTurn: creatorId,
    status: "waiting",
    ts: new Date().toISOString(),
  };
  state.balloonGames.push(game);
  finishMutation(`${creator.name} is looking for someone brave enough to play Balloon Pop for ${stake}cr!`);
  response.status(201).json(game);
});

app.post("/games/balloon/:id/join", (request, response) => {
  if (!isRecord(request.body) || typeof request.body.userId !== "string") {
    sendError(response, 400, "userId is required");
    return;
  }

  const game = state.balloonGames.find((g) => g.id === request.params.id);
  if (!game) {
    sendError(response, 404, "Balloon game not found");
    return;
  }
  if (game.status !== "waiting") {
    sendError(response, 409, "Game already started");
    return;
  }
  if (game.player1 === request.body.userId) {
    sendError(response, 409, "You cannot play against yourself");
    return;
  }

  const joiner = userById(request.body.userId);
  if (!joiner) {
    sendError(response, 404, "User not found");
    return;
  }
  if (joiner.balance < game.stake) {
    sendError(response, 409, "Not enough spendable credits");
    return;
  }

  joiner.balance -= game.stake;
  game.player2 = joiner.id;
  game.p2Credits = game.stake;
  game.status = "playing";
  game.currentTurn = game.player1;
  const creator = userById(game.player1);
  finishMutation(`${joiner.name} accepted ${creator?.name ?? "unknown"}'s Balloon Pop challenge! ${game.stake * 2}cr on the line.`);
  response.json(game);
});

app.post("/games/balloon/:id/inflate", (request, response) => {
  if (!isRecord(request.body) || typeof request.body.userId !== "string") {
    sendError(response, 400, "userId is required");
    return;
  }
  const pumps = typeof request.body.pumps === "number" ? request.body.pumps : 1;
  if (!Number.isInteger(pumps) || pumps < 1 || pumps > 5) {
    sendError(response, 400, "pumps must be 1-5");
    return;
  }

  const game = state.balloonGames.find((g) => g.id === request.params.id);
  if (!game) {
    sendError(response, 404, "Balloon game not found");
    return;
  }
  if (game.status !== "playing") {
    sendError(response, 409, "Game is not in progress");
    return;
  }
  if (game.currentTurn !== request.body.userId) {
    sendError(response, 403, "It's not your turn");
    return;
  }

  const isP1 = game.player1 === request.body.userId;
  const pumper = userById(request.body.userId);
  game.lastPumps = pumps;

  // Roll each pump independently. Pop chance per pump = min(0.9, 0.04 * (totalPumps + 1))
  let popped = false;
  for (let i = 0; i < pumps; i++) {
    game.pumpCount += 1;
    const popChance = Math.min(0.9, 0.04 * game.pumpCount);
    if (Math.random() < popChance) {
      popped = true;
      break;
    }
  }

  if (popped) {
    // Popper loses: all their remaining credits go to opponent
    game.status = "popped";
    game.poppedBy = request.body.userId;
    game.winnerId = isP1 ? game.player2! : game.player1;
    const winner = userById(game.winnerId);
    if (!winner) throw new Error("Balloon winner disappeared");
    // Winner gets everything remaining in both pools
    const totalRemaining = game.p1Credits + game.p2Credits;
    winner.balance += totalRemaining;
    game.p1Credits = 0;
    game.p2Credits = 0;
    finishMutation(`POP! ${pumper?.name ?? "Unknown"} blew it on pump #${game.pumpCount}! ${winner.name} takes ${totalRemaining}cr!`);
  } else {
    // Survived! Steal credits from opponent proportional to pumps chosen
    const reward = Math.ceil(game.stake / 10) * pumps;
    if (isP1) {
      const stolen = Math.min(reward, game.p2Credits);
      game.p2Credits -= stolen;
      game.p1Credits += stolen;
    } else {
      const stolen = Math.min(reward, game.p1Credits);
      game.p1Credits -= stolen;
      game.p2Credits += stolen;
    }

    // Check if opponent is drained
    const opponentCredits = isP1 ? game.p2Credits : game.p1Credits;
    if (opponentCredits <= 0) {
      game.status = "drained";
      game.winnerId = request.body.userId;
      const winner = userById(request.body.userId);
      if (!winner) throw new Error("Balloon winner disappeared");
      const totalRemaining = game.p1Credits + game.p2Credits;
      winner.balance += totalRemaining;
      game.p1Credits = 0;
      game.p2Credits = 0;
      finishMutation(`${winner.name} drained all credits in Balloon Pop! Took ${totalRemaining}cr without a pop!`);
    } else {
      game.currentTurn = isP1 ? game.player2! : game.player1;
      finishMutation(`${pumper?.name ?? "Unknown"} survived ${pumps} pump${pumps > 1 ? "s" : ""} and stole ${Math.ceil(game.stake / 10) * pumps}cr!`);
    }
  }

  response.json(game);
});

// ===== FEATURE 4: SPECTATOR SHELL (A/E) =====

app.get("/", (_request, response) => {
  response.redirect("/spectate");
});

app.post("/usage/simulate", (request, response) => {
  if (!isRecord(request.body)) {
    sendError(response, 400, "Request body must be an object");
    return;
  }

  const { userId, credits } = request.body;
  if (typeof userId !== "string") {
    sendError(response, 400, "userId is required");
    return;
  }
  if (!isPositiveInteger(credits)) {
    sendError(response, 400, "credits must be a positive integer");
    return;
  }

  const user = userById(userId);
  if (!user) {
    sendError(response, 404, "User not found");
    return;
  }
  if (credits > user.weeklyQuota) {
    sendError(response, 400, "credits cannot exceed the user's weekly quota");
    return;
  }
  if (user.usageHistory.length === 0) {
    sendError(response, 409, "User has no usage history to update");
    return;
  }

  const newestSampleIndex = user.usageHistory.length - 1;
  user.usageHistory[newestSampleIndex] += credits;
  finishMutation(`${user.name} ran a simulated ${credits}-credit workload; demand forecast updated.`);
  response.json({
    userId: user.id,
    addedUsageCredits: credits,
    currentDailyUsage: user.usageHistory[newestSampleIndex],
    predictedUsagePct: user.predictedUsagePct,
  });
});

app.post("/admin/reset", (_request, response) => {
  state = createSeedState();
  nextListingId = state.listings.length + 1;
  nextTradeId = 1;
  nextBetId = 1;
  finishMutation("Demo reset to the seeded organization state.");
  response.json({ reset: true, state });
});

app.get("/admin", (_request, response) => {
  response.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>Compute Exchange Forecast Console</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
      color: #f4eee5;
      background: #090807;
      --accent: #f2eadf;
      --canvas: #141210;
      --canvas-deep: #090807;
      --glass: rgba(38, 35, 32, .72);
      --glass-strong: rgba(47, 43, 39, .9);
      --glass-soft: rgba(247, 239, 228, .07);
      --ink: #f4eee5;
      --ink-soft: #d2c8bc;
      --muted: #a49a8f;
      --line: rgba(250, 241, 228, .11);
      --line-strong: rgba(250, 241, 228, .19);
      --shadow: 0 24px 72px rgba(0, 0, 0, .4), inset 0 1px 0 rgba(255, 250, 242, .1);
    }
    * { box-sizing: border-box; }
    body {
      min-height: 100vh;
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(circle at 92% -4%, rgba(181, 119, 82, .18), transparent 34%),
        radial-gradient(circle at -16% 34%, rgba(255, 247, 235, .065), transparent 36%),
        linear-gradient(155deg, #1d1a17 0%, var(--canvas) 48%, var(--canvas-deep) 100%);
      -webkit-font-smoothing: antialiased;
    }
    main { width: min(1180px, 100%); margin: 0 auto; padding: 20px 16px 52px; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
    .brand { color: var(--ink-soft); font-size: 13px; font-weight: 760; }
    #status {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 7px 11px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--muted);
      background: var(--glass-soft);
      box-shadow: inset 0 1px 0 rgba(255, 250, 242, .08);
      font-size: 12px;
      font-weight: 680;
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
    }
    #status::before { width: 7px; height: 7px; border-radius: 50%; background: #69645f; content: ""; }
    #status.live { color: var(--ink); }
    #status.live::before { background: var(--accent); box-shadow: 0 0 16px rgba(242, 234, 223, .38); }
    .hero { padding: 52px 2px 30px; }
    .kicker { margin: 0 0 12px; color: var(--ink-soft); font-size: 11px; font-weight: 760; letter-spacing: .1em; text-transform: uppercase; }
    h1 { max-width: 780px; margin: 0; font-size: clamp(38px, 8vw, 72px); font-weight: 680; line-height: .98; letter-spacing: -.052em; }
    .hero-copy { max-width: 650px; margin: 18px 0 0; color: var(--muted); font-size: 15px; line-height: 1.55; }
    .metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .metric, .panel, .person {
      border: 1px solid var(--line);
      background: var(--glass);
      box-shadow: var(--shadow);
      backdrop-filter: blur(30px) saturate(115%);
      -webkit-backdrop-filter: blur(30px) saturate(115%);
    }
    .metric { min-width: 0; min-height: 138px; padding: 17px; border-radius: 24px; }
    .metric span { display: block; color: var(--ink-soft); font-size: 12px; font-weight: 700; }
    .metric strong { display: block; margin-top: 13px; overflow-wrap: anywhere; font-size: clamp(24px, 6vw, 36px); font-weight: 690; letter-spacing: -.04em; }
    .metric small { display: block; margin-top: 7px; color: var(--muted); font-size: 11px; line-height: 1.35; }
    .grid { display: grid; gap: 12px; margin-top: 12px; }
    .panel { min-width: 0; padding: 18px; border-radius: 26px; }
    .panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 18px; }
    h2, h3 { margin: 0; letter-spacing: -.025em; }
    h2 { font-size: 18px; }
    h3 { font-size: 14px; }
    .panel-copy { max-width: 55ch; margin: 5px 0 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
    .chip { flex: 0 0 auto; padding: 6px 9px; border: 1px solid var(--line-strong); border-radius: 999px; color: var(--ink-soft); font-size: 10px; font-weight: 700; }
    .sparkline { display: flex; height: 116px; align-items: end; gap: clamp(4px, 1.3vw, 10px); padding: 13px; border: 1px solid rgba(250, 241, 228, .07); border-radius: 18px; background: rgba(247, 239, 228, .04); }
    .sparkline i { min-width: 4px; flex: 1; border-radius: 5px 5px 2px 2px; background: linear-gradient(180deg, var(--accent), rgba(242, 234, 223, .24)); box-shadow: 0 0 14px rgba(242, 234, 223, .08); }
    .trend-labels { display: flex; justify-content: space-between; margin-top: 8px; color: var(--muted); font-size: 10px; }
    #people { display: grid; gap: 10px; }
    .person { padding: 15px; border-radius: 19px; background: rgba(247, 239, 228, .045); }
    .person-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .person-values { color: var(--muted); font-size: 11px; text-align: right; }
    .person .sparkline { height: 58px; margin-top: 12px; padding: 7px; gap: 3px; border-radius: 12px; }
    .forecast-note { display: grid; gap: 12px; }
    .step { padding: 14px; border: 1px solid rgba(250, 241, 228, .07); border-radius: 16px; color: var(--ink-soft); background: rgba(247, 239, 228, .04); font-size: 12px; line-height: 1.5; }
    .step strong { display: block; margin-bottom: 4px; color: var(--ink); font-size: 13px; }
    .boundary { margin: 19px 3px 0; color: var(--muted); font-size: 11px; line-height: 1.5; }
    @media (min-width: 760px) {
      main { padding: 28px 28px 66px; }
      .metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .grid { grid-template-columns: 1.08fr .92fr; }
      .trend { grid-column: 1 / -1; }
      .metric { min-height: 132px; padding: 20px; }
      .panel { padding: 21px; }
    }
    @media (max-width: 480px) {
      .metric { min-height: 150px; }
      .panel-head, .person-head { display: grid; }
      .person-values { text-align: left; }
    }
  </style>
</head>
<body>
  <main>
    <header><div class="brand">Compute Exchange · Admin</div><div id="status">Connecting</div></header>
    <section class="hero">
      <p class="kicker">Read-only forecast console</p>
      <h1>See where AI budget goes next.</h1>
      <p class="hero-copy">Live demand history, projected weekly usage, and the savings available from moving existing internal allocation.</p>
    </section>
    <section class="metrics" aria-label="Organization forecast summary">
      <article class="metric"><span>Spendable balance</span><strong id="balance">—</strong><small>Credits currently available across teammates</small></article>
      <article class="metric"><span>Weekly quota</span><strong id="quota">—</strong><small>Total planned capacity for the organization</small></article>
      <article class="metric"><span>Projected this week</span><strong id="projected">—</strong><small id="utilization">Across all weekly quotas</small></article>
      <article class="metric"><span>Savings on the table</span><strong id="savings">—</strong><small>Estimated from current transfer suggestions</small></article>
    </section>
    <section class="grid">
      <article class="panel trend">
        <div class="panel-head"><div><h2>Organization usage trend</h2><p class="panel-copy">Daily credits used across the team, summed from each person's 14-day history.</p></div><span class="chip">14 days</span></div>
        <div id="team-trend"></div>
      </article>
      <article class="panel">
        <div class="panel-head"><div><h2>Team forecasts</h2><p class="panel-copy">Projected credits, quota, utilization, and recent usage for every teammate.</p></div><span class="chip">Live state</span></div>
        <div id="people"></div>
      </article>
      <article class="panel">
        <div class="panel-head"><div><h2>How the forecast works</h2><p class="panel-copy">The same server-side model that creates team transfer suggestions.</p></div><span class="chip">Server model</span></div>
        <div class="forecast-note">
          <div class="step"><strong>1 · Weight recent behavior</strong>The model separates the 14-day history into weekdays and weekends. Within each group, newer samples receive larger linear weights.</div>
          <div class="step"><strong>2 · Project seven days</strong>Five times the weighted weekday average plus two times the weighted weekend average becomes projected weekly credits. Dividing by quota gives forecast utilization, clamped from 0–100%.</div>
          <div class="step"><strong>3 · Find safe moves</strong>Teammates below 60% forecast utilization can supply surplus; teammates above 85% may need capacity. The server greedily pairs them and computes the displayed savings.</div>
        </div>
      </article>
    </section>
    <p class="boundary">Read-only view. Usage forecasts inform transfers of internal demo allocation only; no vendor credits, accounts, credentials, or money move between people.</p>
  </main>
  <script>
    const elements = {
      status: document.getElementById("status"),
      balance: document.getElementById("balance"),
      quota: document.getElementById("quota"),
      projected: document.getElementById("projected"),
      utilization: document.getElementById("utilization"),
      savings: document.getElementById("savings"),
      teamTrend: document.getElementById("team-trend"),
      people: document.getElementById("people"),
    };
    const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
    let reconnectTimer;

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\\"": "&quot;", "'": "&#39;",
      })[character]);
    }

    function normalizedHistory(history) {
      const clean = Array.isArray(history)
        ? history.map((value) => Number.isFinite(value) ? Math.max(0, value) : 0).slice(-14)
        : [];
      return Array(14 - clean.length).fill(0).concat(clean);
    }

    function sparkline(values) {
      const safeValues = normalizedHistory(values);
      const maximum = Math.max(1, ...safeValues);
      const bars = safeValues.map((value) => '<i style="height:'
        + Math.max(4, Math.round((value / maximum) * 100)) + '%" title="'
        + number.format(value) + ' credits"></i>').join("");
      return '<div class="sparkline" role="img" aria-label="Fourteen-day usage trend">'
        + bars + '</div><div class="trend-labels"><span>14 days ago</span><span>Today</span></div>';
    }

    function renderState(state) {
      const users = Array.isArray(state.users) ? state.users : [];
      const totalBalance = users.reduce((sum, user) => sum + user.balance, 0);
      const totalQuota = users.reduce((sum, user) => sum + user.weeklyQuota, 0);
      const totalProjected = users.reduce((sum, user) => sum + user.weeklyQuota * user.predictedUsagePct, 0);
      const utilization = totalQuota === 0 ? 0 : totalProjected / totalQuota;
      const savings = state.suggestions.reduce((sum, suggestion) => sum + suggestion.projectedSavings, 0);
      const teamHistory = Array.from({ length: 14 }, (_unused, index) => users.reduce(
        (sum, user) => sum + normalizedHistory(user.usageHistory)[index], 0));

      elements.balance.textContent = number.format(totalBalance) + " credits";
      elements.quota.textContent = number.format(totalQuota) + " credits";
      elements.projected.textContent = number.format(totalProjected) + " credits";
      elements.utilization.textContent = Math.round(utilization * 100) + "% of total quota";
      elements.savings.textContent = "$" + number.format(savings) + "/wk";
      elements.teamTrend.innerHTML = sparkline(teamHistory);
      elements.people.innerHTML = users.slice().sort((left, right) => right.predictedUsagePct - left.predictedUsagePct)
        .map((user) => {
          const projected = user.weeklyQuota * user.predictedUsagePct;
          return '<article class="person"><div class="person-head"><h3>' + escapeHtml(user.name)
            + '</h3><div class="person-values">' + number.format(projected) + ' projected / '
            + number.format(user.weeklyQuota) + ' quota · ' + Math.round(user.predictedUsagePct * 100)
            + '%</div></div>' + sparkline(user.usageHistory) + '</article>';
        }).join("");
    }

    function connect() {
      clearTimeout(reconnectTimer);
      elements.status.textContent = "Connecting";
      elements.status.classList.remove("live");
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(protocol + "//" + location.host);
      socket.addEventListener("open", () => {
        elements.status.textContent = "Live";
        elements.status.classList.add("live");
      });
      socket.addEventListener("close", () => {
        elements.status.textContent = "Reconnecting";
        elements.status.classList.remove("live");
        reconnectTimer = setTimeout(connect, 1200);
      });
      socket.addEventListener("error", () => socket.close());
      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "state") renderState(message.state);
        } catch (_error) {
          elements.status.textContent = "Invalid update";
          elements.status.classList.remove("live");
        }
      });
    }

    connect();
  </script>
</body>
</html>`);
});

app.get("/spectate", (_request, response) => {
  response.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>Compute Exchange Live</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
      background: #090807;
      color: #f4eee5;
      --accent: #f2eadf;
      --canvas: #141210;
      --canvas-deep: #090807;
      --panel: rgba(38, 35, 32, .72);
      --panel-solid: rgba(247, 239, 228, .07);
      --line: rgba(250, 241, 228, .11);
      --line-warm: rgba(250, 241, 228, .19);
      --ink: #f4eee5;
      --ink-soft: #d2c8bc;
      --muted: #a49a8f;
      --shadow: 0 24px 72px rgba(0, 0, 0, .4), inset 0 1px 0 rgba(255, 250, 242, .1);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      overflow-x: hidden;
      background:
        radial-gradient(circle at 92% -4%, rgba(181, 119, 82, .18), transparent 34%),
        radial-gradient(circle at -16% 34%, rgba(255, 247, 235, .065), transparent 36%),
        linear-gradient(155deg, #1d1a17 0%, var(--canvas) 48%, var(--canvas-deep) 100%);
    }
    body::before, body::after {
      content: "";
      position: fixed;
      z-index: -1;
      border-radius: 999px;
      filter: blur(2px);
      pointer-events: none;
    }
    body::before { width: 240px; height: 240px; top: 18%; right: -100px; background: rgba(255, 248, 239, .07); box-shadow: 0 0 90px rgba(210, 170, 139, .07); }
    body::after { width: 180px; height: 180px; bottom: 8%; left: -90px; background: rgba(255, 247, 235, .045); box-shadow: 0 0 70px rgba(255, 247, 235, .04); }
    main { width: min(1080px, 100%); min-width: 0; margin: 0 auto; padding: 18px 16px 44px; overflow: hidden; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .brand { font-size: 13px; font-weight: 760; letter-spacing: -.01em; }
    #status {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 7px 11px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(255, 249, 239, .06);
      color: var(--muted);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, .08), 0 10px 28px rgba(0, 0, 0, .18);
      font-size: 12px;
      font-weight: 650;
      backdrop-filter: blur(18px) saturate(130%);
      -webkit-backdrop-filter: blur(18px) saturate(130%);
    }
    #status::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #69645f; }
    #status.live { color: var(--ink); }
    #status.live::before { background: var(--accent); }
    .hero { padding: 52px 2px 30px; }
    .kicker { margin: 0 0 13px; color: var(--ink-soft); font-size: 12px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
    h1 { max-width: 800px; margin: 0; font-size: clamp(40px, 9vw, 76px); font-weight: 680; line-height: .98; letter-spacing: -.052em; }
    .hero p { max-width: 610px; margin: 20px 0 0; color: var(--ink-soft); font-size: 15px; line-height: 1.6; }
    .metrics { display: grid; min-width: 0; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .metric, .panel {
      border: 1px solid var(--line);
      background: var(--panel);
      box-shadow: var(--shadow);
      backdrop-filter: blur(30px) saturate(115%);
      -webkit-backdrop-filter: blur(30px) saturate(115%);
    }
    .metric { position: relative; min-width: 0; min-height: 142px; padding: 17px; overflow: hidden; border-radius: 24px; }
    .metric > span { display: block; color: var(--ink-soft); font-size: 12px; font-weight: 720; }
    .metric strong { display: block; margin-top: 14px; overflow-wrap: anywhere; font-size: clamp(25px, 7vw, 38px); font-weight: 690; letter-spacing: -.045em; }
    .metric small { display: block; max-width: 20ch; margin-top: 8px; color: var(--muted); font-size: 11px; line-height: 1.35; }
    .metric.positive::after { content: ""; position: absolute; width: 9px; height: 9px; top: 18px; right: 18px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 5px rgba(242, 234, 223, .1), 0 0 24px rgba(242, 234, 223, .3); }
    .layout { display: grid; gap: 12px; margin-top: 12px; }
    .panel { padding: 18px; overflow: hidden; border-radius: 26px; }
    .panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
    .panel-head > * { min-width: 0; }
    h2 { margin: 0; font-size: 17px; font-weight: 700; letter-spacing: -.025em; }
    .panel-copy { max-width: 30ch; margin: 5px 0 0; color: var(--muted); font-size: 11px; line-height: 1.4; }
    .eyebrow { flex: 0 0 auto; padding: 6px 9px; border: 1px solid var(--line-warm); border-radius: 999px; color: var(--ink-soft); font-size: 10px; font-weight: 680; white-space: nowrap; }
    #feed, #members, #offers { display: grid; gap: 9px; }
    .event, .member, .offer, .empty { padding: 13px 14px; border: 1px solid rgba(255, 248, 236, .07); border-radius: 16px; background: var(--panel-solid); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .055), 0 8px 24px rgba(0, 0, 0, .12); }
    .event { font-size: 14px; line-height: 1.42; }
    .event time, .empty { color: var(--muted); font-size: 11px; }
    .event time { display: block; margin-top: 6px; }
    .member-top { display: grid; grid-template-columns: 1fr auto; align-items: baseline; gap: 6px 12px; }
    .offer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .member-name, .offer strong { color: var(--ink); font-size: 13px; font-weight: 720; }
    .member-values, .offer span { color: var(--muted); font-size: 11px; }
    .member-values { text-align: right; }
    .bar { height: 6px; margin-top: 10px; overflow: hidden; border-radius: 99px; background: rgba(255, 248, 236, .075); }
    .bar i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #aaa096, var(--accent)); box-shadow: 0 0 16px rgba(242, 234, 223, .14); }
    .boundary { margin: 19px 3px 0; color: var(--muted); font-size: 11px; line-height: 1.5; }
    @media (min-width: 760px) {
      main { padding: 26px 28px 64px; }
      .metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .layout { grid-template-columns: 1.1fr .9fr; }
      .activity { grid-row: span 2; }
      .metric { min-height: 128px; padding: 20px; }
      .panel { padding: 21px; }
    }
    @media (max-width: 420px) {
      .hero { padding-top: 42px; }
      .metric { min-height: 152px; }
      .member-top { grid-template-columns: 1fr; }
      .member-values { text-align: left; }
    }
    @media (prefers-reduced-motion: no-preference) {
      .event { animation: enter .22s ease-out; }
      @keyframes enter { from { opacity: 0; transform: translateY(-5px); } }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="brand">Compute Exchange</div>
      <div id="status">Connecting</div>
    </header>
    <section class="hero">
      <p class="kicker">Live team allocation</p>
      <h1>Put unused AI budget to work.</h1>
      <p>When one teammate needs more capacity, Compute Exchange moves spare internal credits from someone who needs less. Watch every workload and transfer update live.</p>
    </section>
    <section class="metrics" aria-label="Live exchange summary">
      <div class="metric"><span>Total team credits</span><strong id="allocation">—</strong><small>Available now or held safely for an open action</small></div>
      <div class="metric"><span>Offers ready</span><strong id="open-offers">—</strong><small>Allocations teammates can claim</small></div>
      <div class="metric"><span>Transfers made</span><strong id="moves">—</strong><small>Completed moves between teammates</small></div>
      <div class="metric positive"><span>Weekly savings available</span><strong id="savings">—</strong><small>Estimated if the current team matches are accepted</small></div>
    </section>
    <section class="layout">
      <section class="panel activity">
        <div class="panel-head"><div><h2>What is happening</h2><p class="panel-copy">Workloads, offers, transfers, and games appear here as they happen.</p></div><span class="eyebrow">Live</span></div>
        <div id="feed" aria-live="polite"><div class="empty">Waiting for the next team action…</div></div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Who may need capacity</h2><p class="panel-copy">Forecast shows how much of each person's weekly allocation they are likely to use.</p></div><span class="eyebrow">Next 7 days</span></div>
        <div id="members"></div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Credits available to the team</h2><p class="panel-copy">Open offers move internal budget without sharing vendor accounts or keys.</p></div><span class="eyebrow">Inside this team</span></div>
        <div id="offers"></div>
      </section>
    </section>
    <p class="boundary">These demo credits are internal planning units with no cash value. Vendor credits, accounts, and credentials never move between people.</p>
  </main>
  <script>
    const elements = {
      status: document.getElementById("status"),
      allocation: document.getElementById("allocation"),
      offers: document.getElementById("open-offers"),
      moves: document.getElementById("moves"),
      savings: document.getElementById("savings"),
      feed: document.getElementById("feed"),
      members: document.getElementById("members"),
      offerList: document.getElementById("offers"),
    };
    const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
    let reconnectTimer;

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\\"": "&quot;", "'": "&#39;",
      })[character]);
    }

    function renderState(state) {
      const openListings = state.listings.filter((listing) => listing.status === "open");
      const openBets = state.bets.filter((bet) => bet.status === "open");
      const allocated = state.users.reduce((sum, user) => sum + user.balance, 0)
        + openListings.reduce((sum, listing) => sum + listing.amount, 0)
        + openBets.reduce((sum, bet) => sum + bet.stake, 0);
      const savings = state.suggestions.reduce((sum, suggestion) => sum + suggestion.projectedSavings, 0);
      elements.allocation.textContent = number.format(allocated) + " credits";
      elements.offers.textContent = String(openListings.length);
      elements.moves.textContent = String(state.trades.length);
      elements.savings.textContent = "$" + number.format(savings) + "/wk";

      elements.members.innerHTML = state.users
        .slice()
        .sort((left, right) => right.predictedUsagePct - left.predictedUsagePct)
        .slice(0, 6)
        .map((user) => {
          const forecast = Math.round(user.predictedUsagePct * 100);
          return '<article class="member"><div class="member-top"><span class="member-name">'
            + escapeHtml(user.name) + '</span><span class="member-values">Forecast: ' + forecast
            + '% · ' + number.format(user.balance) + ' credits available</span></div><div class="bar"><i style="width:'
            + Math.min(100, Math.max(0, forecast)) + '%"></i></div></article>';
        })
        .join("");

      const names = new Map(state.users.map((user) => [user.id, user.name]));
      elements.offerList.innerHTML = openListings.length === 0
        ? '<div class="empty">No spare credits are being offered right now.</div>'
        : openListings.slice(0, 5).map((listing) => '<article class="offer"><div><strong>'
          + number.format(listing.amount) + ' credits</strong><br><span>Offered by '
          + escapeHtml(names.get(listing.sellerId) || listing.sellerId)
          + '</span></div><span>' + Number(listing.pricePerCredit).toFixed(2) + '× internal rate</span></article>').join("");
    }

    function addEvent(text) {
      const placeholder = elements.feed.querySelector(".empty");
      if (placeholder) placeholder.remove();
      const item = document.createElement("article");
      item.className = "event";
      const copy = document.createElement("div");
      copy.textContent = text;
      const timestamp = document.createElement("time");
      timestamp.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
      item.append(copy, timestamp);
      elements.feed.prepend(item);
      while (elements.feed.children.length > 12) elements.feed.lastElementChild.remove();
    }

    function connect() {
      clearTimeout(reconnectTimer);
      elements.status.textContent = "Connecting";
      elements.status.classList.remove("live");
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(protocol + "//" + location.host);
      socket.addEventListener("open", () => {
        elements.status.textContent = "Live";
        elements.status.classList.add("live");
      });
      socket.addEventListener("close", () => {
        elements.status.textContent = "Reconnecting";
        elements.status.classList.remove("live");
        reconnectTimer = setTimeout(connect, 1200);
      });
      socket.addEventListener("error", () => socket.close());
      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "state") renderState(message.state);
          if (message.type === "event") addEvent(message.text);
        } catch (_error) {
          elements.status.textContent = "Invalid update";
          elements.status.classList.remove("live");
        }
      });
    }

    connect();
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
