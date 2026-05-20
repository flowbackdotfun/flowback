import { MockGeyserSource } from "./mock-source.js";
import type { GeyserSource } from "./types.js";
import { YellowstoneGeyserSource } from "./yellowstone-source.js";

/**
 * Pick the geyser source from the environment.
 *
 *  - `GEYSER_SOURCE=mock` (default) — in-process synthetic stream; no validator
 *    or paid endpoint needed. Set `MOCK_CASHBACK_INTERVAL_MS` to have it
 *    self-emit `CashbackSettled` events for end-to-end dev testing.
 *  - `GEYSER_SOURCE=yellowstone` — real Yellowstone gRPC. Requires
 *    `YELLOWSTONE_GRPC_URL`; `YELLOWSTONE_X_TOKEN` is optional.
 */
export function createGeyserSource(): GeyserSource {
  const kind = (process.env.GEYSER_SOURCE ?? "mock").trim().toLowerCase();

  if (kind === "yellowstone") {
    const endpoint = process.env.YELLOWSTONE_GRPC_URL;
    if (!endpoint) {
      throw new Error(
        "YELLOWSTONE_GRPC_URL is required when GEYSER_SOURCE=yellowstone",
      );
    }
    const xToken = process.env.YELLOWSTONE_X_TOKEN || undefined;
    console.log(`[geyser] source=yellowstone endpoint=${endpoint}`);
    return new YellowstoneGeyserSource({ endpoint, xToken });
  }

  if (kind === "mock") {
    const raw = process.env.MOCK_CASHBACK_INTERVAL_MS;
    const syntheticCashbackIntervalMs =
      raw && Number.isFinite(Number(raw)) && Number(raw) > 0
        ? Number(raw)
        : undefined;
    console.log(
      "[geyser] source=mock" +
        (syntheticCashbackIntervalMs
          ? ` syntheticCashbackIntervalMs=${syntheticCashbackIntervalMs}`
          : ""),
    );
    return new MockGeyserSource({ syntheticCashbackIntervalMs });
  }

  throw new Error(
    `unknown GEYSER_SOURCE "${kind}" (expected "mock" or "yellowstone")`,
  );
}
