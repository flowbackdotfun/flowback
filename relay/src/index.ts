import "dotenv/config";
import express from "express";
import { App } from "uWebSockets.js";
import {
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
} from "@solana/kit";

import { AuctionManager } from "./auction/manager.js";
import { startCashbackIndexer } from "./indexer/cashback.js";
import { createHistoryRoutes } from "./routes/history.route.js";
import { createIntentRoutes } from "./routes/intent.route.js";
import { createPrepareRoutes } from "./routes/prepare.route.js";
import { createQuoteRoutes } from "./routes/quote.route.js";
import { PreparedSwapStore } from "./services/prepare-store.js";
import { attachSearcherWs, SearcherWsRegistry } from "./ws/searcher.js";
import { attachUserStatusWs, UserStatusEmitter } from "./ws/user.js";

const REST_PORT = Number(process.env.REST_PORT ?? process.env.PORT ?? 3001);
const WS_PORT = Number(process.env.WS_PORT ?? 3002);

const SOLANA_RPC_URL = requireEnv("SOLANA_RPC_URL");
const FLOWBACK_PROGRAM_ID = requireEnv("FLOWBACK_PROGRAM_ID");
const TREASURY_WALLET = requireEnv("TREASURY_WALLET");

async function main(): Promise<void> {
  const rpc = createSolanaRpc(SOLANA_RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(
    toWsUrl(SOLANA_RPC_URL),
  );

  const registry = new SearcherWsRegistry();
  const emitter = new UserStatusEmitter();
  const auctionManager = new AuctionManager({ searcherRegistry: registry });
  const preparedSwaps = new PreparedSwapStore();

  const httpApp = express();
  httpApp.use(express.json({ limit: "256kb" }));
  httpApp.get("/health", (_req, res) => {
    res.json({
      ok: true,
      searchers: registry.size(),
      preparedSwaps: preparedSwaps.size(),
    });
  });
  httpApp.use(createQuoteRoutes());
  httpApp.use(createPrepareRoutes({ store: preparedSwaps }));
  httpApp.use(
    createIntentRoutes({
      auctionManager,
      registry,
      emitter,
      store: preparedSwaps,
      programId: FLOWBACK_PROGRAM_ID,
      treasury: TREASURY_WALLET,
      rpc,
    }),
  );
  httpApp.use(createHistoryRoutes());
  httpApp.listen(REST_PORT, () => {
    console.log(`[relay] http listening on :${REST_PORT}`);
  });

  const wsApp = App();
  attachSearcherWs(wsApp, {
    auctionManager,
    registry,
    programId: FLOWBACK_PROGRAM_ID,
    treasury: TREASURY_WALLET,
  });
  attachUserStatusWs(wsApp, emitter);
  wsApp.listen(WS_PORT, (listenSocket) => {
    if (!listenSocket) {
      console.error(`[relay] failed to bind ws port ${WS_PORT}`);
      process.exit(1);
    }
    console.log(`[relay] ws listening on :${WS_PORT}`);
  });

  startCashbackIndexer({
    rpcSubscriptions,
    programId: FLOWBACK_PROGRAM_ID,
    emitter,
  });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function toWsUrl(httpUrl: string): string {
  if (httpUrl.startsWith("https://")) return "wss://" + httpUrl.slice(8);
  if (httpUrl.startsWith("http://")) return "ws://" + httpUrl.slice(7);
  return httpUrl;
}

main().catch((err) => {
  console.error("[relay] fatal:", err);
  process.exit(1);
});
