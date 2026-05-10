import "dotenv/config";

const MOCK_JUPITER = process.env.MOCK_JUPITER === "true";

const JUPITER_BUILD_API_URL = process.env.JUPITER_BUILD_API_URL;
const JUPITER_API_KEY = process.env.JUPITER_API_KEY;
const JUPITER_DEXES = process.env.JUPITER_DEXES;
const JUPITER_DIRECT_ROUTES = process.env.JUPITER_DIRECT_ROUTES === "true";
const MOCK_JITO = process.env.MOCK_JITO === "true";

if (!MOCK_JUPITER) {
  if (!JUPITER_BUILD_API_URL) throw new Error("JUPITER_BUILD_API_URL is not set");
  if (!JUPITER_API_KEY) throw new Error("JUPITER_API_KEY is not set");
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

/**
 * Uses the /build endpoint for both quote and build — same routing
 * constraints (dexes, onlyDirectRoutes) are always applied.
 * For quote-only calls, a dummy taker is used since we just need pricing.
 */
const DUMMY_TAKER = "11111111111111111111111111111111";

function buildQuery(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  taker: string;
  slippageBps?: number;
  tipAmount?: string;
}): URLSearchParams {
  const query = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    taker: params.taker,
  });
  if (params.slippageBps !== undefined && params.slippageBps > 0) {
    query.set("slippageBps", params.slippageBps.toString());
  } else {
    query.set("slippageBps", "rtse");
  }
  if (params.tipAmount !== undefined) {
    query.set("tipAmount", params.tipAmount);
  }
  if (JUPITER_DEXES) {
    query.set("dexes", JUPITER_DEXES);
  }
  if (JUPITER_DIRECT_ROUTES) {
    query.set("onlyDirectRoutes", "true");
  }
  query.set("maxAccounts", "54");
  if (MOCK_JITO) {
    query.set("wrapAndUnwrapSol", "false");
  }
  return query;
}

async function fetchBuild(query: URLSearchParams): Promise<JupiterBuildResponse> {
  const url = `${JUPITER_BUILD_API_URL}/build?${query.toString()}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "x-api-key": JUPITER_API_KEY! },
  });
  if (!res.ok) {
    throw new JupiterError("/build", res.status, await res.text());
  }
  return (await res.json()) as JupiterBuildResponse;
}

export async function getQuote(
  inputMint: string,
  outputMint: string,
  amount: bigint | number | string,
  slippageBps: number,
): Promise<JupiterQuoteResponse> {
  if (MOCK_JUPITER) {
    const inAmt = amount.toString();
    const outAmt = String(Math.floor(Number(inAmt) * 0.99));
    return {
      inputMint,
      inAmount: inAmt,
      outputMint,
      outAmount: outAmt,
      otherAmountThreshold: String(Math.floor(Number(inAmt) * (1 - slippageBps / 10_000))),
      swapMode: "ExactIn",
      slippageBps,
      priceImpactPct: "0.10",
      routePlan: [],
    };
  }

  const query = buildQuery({
    inputMint,
    outputMint,
    amount: amount.toString(),
    taker: DUMMY_TAKER,
    slippageBps,
  });

  const build = await fetchBuild(query);
  return build as unknown as JupiterQuoteResponse;
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
  if (MOCK_JUPITER) {
    const inAmt = params.amount.toString();
    const outAmt = String(Math.floor(Number(inAmt) * 0.99));
    return {
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      inAmount: inAmt,
      outAmount: outAmt,
      otherAmountThreshold: String(Math.floor(Number(inAmt) * 0.98)),
      swapMode: "ExactIn",
      slippageBps: params.slippageBps ?? 50,
      priceImpactPct: "0.10",
      routePlan: [],
      setupInstructions: [],
      swapInstruction: {
        programId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
        accounts: [],
        data: Buffer.from("mock-swap").toString("base64"),
      },
      cleanupInstruction: null,
      computeBudgetInstructions: [],
      otherInstructions: [],
      tipInstruction: null,
      addressesByLookupTableAddress: {},
      blockhashWithMetadata: {
        blockhash: "11111111111111111111111111111111",
        lastValidBlockHeight: 999_999_999,
      },
    };
  }

  const query = buildQuery({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount.toString(),
    taker: params.taker,
    slippageBps: params.slippageBps,
    tipAmount: params.tipAmount?.toString(),
  });

  return fetchBuild(query);
}
