export interface SwapTokenAmount {
  userAccount: string;
  mint: string;
  rawTokenAmount: { tokenAmount: string; decimals: number };
}

export interface HeliusSwapEvent {
  nativeInput?: { account: string; amount: string };
  nativeOutput?: { account: string; amount: string };
  tokenInputs: SwapTokenAmount[];
  tokenOutputs: SwapTokenAmount[];
  innerSwaps: {
    programId: string;
    tokenInputs: SwapTokenAmount[];
    tokenOutputs: SwapTokenAmount[];
  }[];
}

export interface HeliusTokenTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  mint: string;
  tokenAmount: number;
  tokenStandard: string;
}

export interface HeliusNativeTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  amount: number;
}

export interface HeliusInstruction {
  programId: string;
  innerInstructions?: { programId: string }[];
}

export interface HeliusEnhancedTransaction {
  signature: string;
  slot: number;
  timestamp: number;
  type: string;
  source: string;
  feePayer: string;
  fee: number;
  events: { swap?: HeliusSwapEvent };
  tokenTransfers?: HeliusTokenTransfer[];
  nativeTransfers?: HeliusNativeTransfer[];
  instructions?: HeliusInstruction[];
}

export interface FetchSwapsResult {
  txs: HeliusEnhancedTransaction[];
  hasMore: boolean;
}

export class HeliusError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Helius ${endpoint} failed: ${status} ${body}`);
    this.name = "HeliusError";
  }
}

const BASE_URL =
  process.env.HELIUS_BASE_URL ?? "https://api-mainnet.helius-rpc.com/v0";

export async function fetchWalletSwaps(
  wallet: string,
  opts?: { maxPages?: number },
): Promise<FetchSwapsResult> {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) throw new HeliusError("config", 0, "HELIUS_API_KEY is not set");

  const maxPages = opts?.maxPages ?? 1;
  const limit = 100;
  const results: HeliusEnhancedTransaction[] = [];
  let before: string | undefined;
  let hasMore = false;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      "api-key": apiKey,
      type: "SWAP",
      limit: limit.toString(),
    });
    if (before) params.set("before", before);

    const url = `${BASE_URL}/addresses/${wallet}/transactions?${params}`;
    const res = await fetch(url);

    if (!res.ok) {
      throw new HeliusError(
        `/addresses/${wallet}/transactions`,
        res.status,
        await res.text(),
      );
    }

    const txs = (await res.json()) as HeliusEnhancedTransaction[];
    results.push(...txs);

    if (txs.length < limit) break;
    before = txs[txs.length - 1].signature;
    if (page === maxPages - 1) hasMore = true;
  }

  return { txs: results, hasMore };
}
