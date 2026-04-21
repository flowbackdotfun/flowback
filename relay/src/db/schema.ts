import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  bigint,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const auctions = pgTable("auctions", {
  id: uuid("id").primaryKey().defaultRandom(),
  hintId: text("hint_id").notNull().unique(),
  userPubkey: text("user_pubkey").notNull(),
  inputMint: text("input_mint").notNull(),
  outputMint: text("output_mint").notNull(),
  inputAmountLamports: bigint("input_amount_lamports", {
    mode: "bigint",
  }).notNull(),
  sizeBucket: text("size_bucket").notNull(),
  winnerPubkey: text("winner_pubkey"),
  winningBidLamports: bigint("winning_bid_lamports", { mode: "bigint" }),
  totalBids: integer("total_bids").notNull().default(0),
  bundleId: text("bundle_id"),
  status: text("status").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  settledAt: timestamp("settled_at"),
});

export const cashbackEvents = pgTable("cashback_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  txSignature: text("tx_signature").notNull().unique(),
  userPubkey: text("user_pubkey").notNull(),
  searcherPubkey: text("searcher_pubkey").notNull(),
  bidAmountLamports: bigint("bid_amount_lamports", {
    mode: "bigint",
  }).notNull(),
  cashbackLamports: bigint("cashback_lamports", { mode: "bigint" }).notNull(),
  protocolFeeLamports: bigint("protocol_fee_lamports", {
    mode: "bigint",
  }).notNull(),
  auctionId: uuid("auction_id").references(() => auctions.id),
  timestamp: timestamp("timestamp").notNull(),
  indexedAt: timestamp("indexed_at").defaultNow(),
});

export const searchers = pgTable("searchers", {
  id: uuid("id").primaryKey().defaultRandom(),
  pubkey: text("pubkey").notNull().unique(),
  registeredAt: timestamp("registered_at").defaultNow(),
  totalBidsSubmitted: integer("total_bids_submitted").notNull().default(0),
  totalBidsWon: integer("total_bids_won").notNull().default(0),
  totalCashbackPaidLamports: bigint("total_cashback_paid_lamports", {
    mode: "bigint",
  })
    .notNull()
    .default(sql`0`),
  lastSeenAt: timestamp("last_seen_at"),
});
