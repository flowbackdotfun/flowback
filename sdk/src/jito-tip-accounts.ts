/**
 * Canonical Jito tip accounts. Bundles must include a tip transfer to one of
 * these eight pubkeys for the Block Engine to route them.
 *
 * This snapshot is captured from the `getTipAccounts` RPC and used as a
 * zero-network fallback. Long-running bots should periodically refresh the
 * pool with {@link fetchJitoTipAccounts} in case Jito rotates the set.
 *
 * Source: `getTipAccounts` on https://mainnet.block-engine.jito.wtf/api/v1
 */
export const JITO_TIP_ACCOUNTS: readonly string[] = [
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
];

/** Default Jito Block Engine RPC endpoint (mainnet). */
export const DEFAULT_JITO_BLOCK_ENGINE_URL =
  "https://mainnet.block-engine.jito.wtf/api/v1";

export interface FetchJitoTipAccountsOptions {
  /** Block Engine endpoint. Defaults to mainnet. */
  endpoint?: string;
  /** Abort signal — wire up a timeout to bound the call. */
  signal?: AbortSignal;
}

/**
 * Fetch the current Jito tip account set from the Block Engine.
 *
 * Opt-in: hardcoded {@link JITO_TIP_ACCOUNTS} is fine for most bots, but if
 * you run long-lived processes you can call this periodically and pass the
 * result to {@link pickJitoTipAccount} to stay in sync with rotations.
 *
 * Throws on network or RPC error — caller decides whether to fall back.
 */
export async function fetchJitoTipAccounts(
  options: FetchJitoTipAccountsOptions = {},
): Promise<string[]> {
  const endpoint = options.endpoint ?? DEFAULT_JITO_BLOCK_ENGINE_URL;
  const res = await fetch(`${endpoint}/getTipAccounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTipAccounts",
      params: [],
    }),
    signal: options.signal,
  });

  if (!res.ok) {
    throw new Error(
      `getTipAccounts failed: ${res.status} ${res.statusText}`,
    );
  }

  const body = (await res.json()) as {
    result?: string[];
    error?: { code: number; message: string };
  };

  if (body.error) {
    throw new Error(
      `getTipAccounts rpc error: ${body.error.code} ${body.error.message}`,
    );
  }
  if (!Array.isArray(body.result) || body.result.length === 0) {
    throw new Error("getTipAccounts returned no accounts");
  }
  return body.result;
}

/** Pick a random Jito tip account. */
export function pickJitoTipAccount(
  pool: readonly string[] = JITO_TIP_ACCOUNTS,
): string {
  return pool[Math.floor(Math.random() * pool.length)]!;
}
