import type { ExchangeState, Listing, User } from "../../shared/types.js";

type SeedUser = Omit<User, "predictedUsagePct">;

const seedUsers: SeedUser[] = [
  {
    id: "u1",
    name: "Liam",
    balance: 420,
    weeklyQuota: 700,
    usageHistory: [62, 66, 61, 59, 27, 24, 64, 68, 72, 70, 31, 26, 74, 78],
  },
  {
    id: "u2",
    name: "Seb",
    balance: 430,
    weeklyQuota: 700,
    usageHistory: [78, 81, 79, 84, 42, 38, 82, 86, 88, 84, 45, 40, 89, 91],
  },
  {
    id: "u3",
    name: "Suraj",
    balance: 380,
    weeklyQuota: 600,
    usageHistory: [38, 42, 40, 44, 20, 18, 41, 43, 46, 45, 22, 19, 47, 49],
  },
  {
    id: "u4",
    name: "Daniel",
    balance: 240,
    weeklyQuota: 600,
    usageHistory: [72, 77, 75, 79, 38, 34, 78, 82, 84, 81, 41, 36, 86, 89],
  },
  {
    id: "u5",
    name: "Amara",
    balance: 390,
    weeklyQuota: 650,
    usageHistory: [47, 51, 49, 53, 25, 22, 50, 54, 55, 52, 27, 23, 57, 59],
  },
  {
    id: "u6",
    name: "Maya",
    balance: 600,
    weeklyQuota: 700,
    usageHistory: [15, 16, 14, 17, 8, 7, 14, 15, 16, 15, 7, 6, 16, 17],
  },
  {
    id: "u7",
    name: "Jordan",
    balance: 120,
    weeklyQuota: 700,
    usageHistory: [84, 88, 91, 94, 48, 43, 96, 101, 105, 109, 58, 52, 114, 121],
  },
  {
    id: "u8",
    name: "Ethan",
    balance: 470,
    weeklyQuota: 700,
    usageHistory: [64, 65, 63, 66, 39, 37, 65, 64, 66, 65, 40, 38, 66, 65],
  },
  {
    id: "u9",
    name: "Priya",
    balance: 260,
    weeklyQuota: 600,
    usageHistory: [35, 37, 36, 39, 88, 94, 34, 38, 36, 40, 91, 98, 37, 39],
  },
  {
    id: "u10",
    name: "Noah",
    balance: 160,
    weeklyQuota: 700,
    usageHistory: [31, 35, 40, 47, 26, 24, 55, 63, 72, 83, 48, 44, 98, 112],
  },
];

const seedListingSpecs = [
  { id: "listing-1", sellerId: "u6", amount: 80, pricePerCredit: 0.32 },
  { id: "listing-2", sellerId: "u3", amount: 40, pricePerCredit: 0.55 },
  { id: "listing-3", sellerId: "u1", amount: 30, pricePerCredit: 0.68 },
];

export function createSeedState(): ExchangeState {
  const users: User[] = seedUsers.map((user) => ({ ...user, usageHistory: [...user.usageHistory], predictedUsagePct: 0 }));
  const createdAt = new Date().toISOString();
  const listings: Listing[] = seedListingSpecs.map((spec) => {
    const seller = users.find((user) => user.id === spec.sellerId);
    if (!seller || seller.balance < spec.amount) {
      throw new Error(`Invalid seed listing ${spec.id}`);
    }
    seller.balance -= spec.amount;
    return { ...spec, createdAt, status: "open" };
  });

  return { users, listings, trades: [], bets: [], wheelGames: [], balloonGames: [], suggestions: [] };
}
