export interface User {
  id: string;
  name: string;
  balance: number;
  weeklyQuota: number;
  usageHistory: number[];
  predictedUsagePct: number;
}

export interface Listing {
  id: string;
  sellerId: string;
  amount: number;
  pricePerCredit: number;
  createdAt: string;
  status: "open" | "filled" | "cancelled";
}

export interface Trade {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  total: number;
  ts: string;
}

export interface Bet {
  id: string;
  challengerId: string;
  opponentId?: string;
  stake: number;
  game: "coinflip";
  status: "open" | "settled";
  winnerId?: string;
  ts: string;
}

export interface TeamSuggestion {
  id: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
  projectedSavings: number;
  reason: string;
}

export interface ExchangeState {
  users: User[];
  listings: Listing[];
  trades: Trade[];
  bets: Bet[];
  suggestions: TeamSuggestion[];
}

export type WsMessage =
  | { type: "state"; state: ExchangeState }
  | { type: "event"; text: string };
