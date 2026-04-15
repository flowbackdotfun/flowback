import "dotenv/config";

const JUPITER_API_URL = process.env.JUPITER_API_URL;
const JUPITER_BUILD_API_URL = process.env.JUPITER_BUILD_API_URL;
const JUPITER_API_KEY = process.env.JUPITER_API_KEY;

if (!JUPITER_API_URL) {
  throw new Error("JUPITER_API_URL is not set");
}

if (!JUPITER_BUILD_API_URL) {
  throw new Error("JUPITER_BUILD_API_URL is not set");
}

if (!JUPITER_API_KEY) {
  throw new Error("JUPITER_API_KEY is not set");
}

export class JupiterError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Jupiter ${endpoint} failed: ${status} ${body}`);
    this.name = "JupiterError";
  }
}

export interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: unknown[];
  contextSlot?: number;
  timeTaken?: number;
  [key: string]: unknown;
}

export interface JupiterInstruction {
  programId: string;
  accounts: Array<{
    pubkey: string;
    isSigner: boolean;
    isWritable: boolean;
  }>;
  data: string;
}

export interface JupiterBuildResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: unknown[];

  setupInstructions: JupiterInstruction[];
  swapInstruction: JupiterInstruction;
  cleanupInstruction: JupiterInstruction | null;
  computeBudgetInstructions: JupiterInstruction[];
  otherInstructions: JupiterInstruction[];
  tipInstruction: JupiterInstruction | null;

  addressesByLookupTableAddress: Record<string, string[]>;
  blockhashWithMetadata: {
    blockhash: string;
    lastValidBlockHeight: number;
    [key: string]: unknown;
  };

  [key: string]: unknown;
}

export async function getQuote(
  inputMint: string,
  outputMint: string,
  amount: bigint | number | string,
  slippageBps: number,
): Promise<JupiterQuoteResponse> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: slippageBps.toString(),
  });

  const url = `${JUPITER_API_URL}/quote?${params.toString()}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new JupiterError("/quote", res.status, await res.text());
  }

  return (await res.json()) as JupiterQuoteResponse;
}

export interface BuildSwapParams {
  inputMint: string;
  outputMint: string;
  amount: bigint | number | string;
  taker: string;
  slippageBps?: number;
  tipAmount?: bigint | number | string;
}

export async function buildSwap(
  params: BuildSwapParams,
): Promise<JupiterBuildResponse> {
  const query = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount.toString(),
    taker: params.taker,
  });

  if (params.slippageBps !== undefined) {
    query.set("slippageBps", params.slippageBps.toString());
  }
  if (params.tipAmount !== undefined) {
    query.set("tipAmount", params.tipAmount.toString());
  }

  const url = `${JUPITER_BUILD_API_URL}/build?${query.toString()}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "x-api-key": JUPITER_API_KEY!,
    },
  });

  if (!res.ok) {
    throw new JupiterError("/build", res.status, await res.text());
  }

  return (await res.json()) as JupiterBuildResponse;
}
