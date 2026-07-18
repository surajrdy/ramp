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

const environmentPort = Number.parseInt(process.env.PORT ?? "", 10);
const PORT = Number.isInteger(environmentPort) && environmentPort > 0 ? environmentPort : 4747;
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

// ===== FEATURE 4: INTEGRATION + SPECTATOR SHELL (Suraj) =====

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
