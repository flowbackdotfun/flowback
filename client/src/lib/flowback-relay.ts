"use client";

import { VersionedTransaction } from "@solana/web3.js";

export type TokenSymbol = "SOL" | "USDC";
export type SwapDirection = "buy" | "sell";

export type TokenMeta = {
  symbol: TokenSymbol;
  mint: string;
  decimals: number;
  displayDecimals: number;
};

export const TOKENS: Record<TokenSymbol, TokenMeta> = {
  SOL: {
    symbol: "SOL",
    mint: "So11111111111111111111111111111111111111112",
    decimals: 9,
    displayDecimals: 6,
  },
  USDC: {
    symbol: "USDC",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
    displayDecimals: 2,
  },
};

export type JupiterQuote = {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: unknown[];
  timeTaken?: number;
};

export type CashbackEstimate = {
  lamports: string;
  sampleSize: number;
};

export type QuoteResponse = {
  quote: JupiterQuote;
  cashbackEstimate: CashbackEstimate | null;
};

export type PrepareResponse = {
  prepareId: string;
  unsignedTx: string;
  expiresAt: number;
};

export type IntentResponse = {
  auctionId: string;
  status: "pending";
};

export type UserStatusEvent =
  | {
      type: "bundle_submitted";
      auctionId: string;
      bundleId: string;
    }
  | {
      type: "cashback_confirmed";
      auctionId: string;
      cashbackLamports: string;
      txSignature: string;
    }
  | {
      type: "fallback_executed";
      auctionId: string;
      txSignature: string;
    }
  | {
      type: "auction_failed";
      auctionId: string;
      reason: string;
    };

export class RelayRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly payload: unknown,
  ) {
    super(getRelayErrorMessage(status, payload));
    this.name = "RelayRequestError";
  }
}

export function inputTokenForDirection(direction: SwapDirection): TokenMeta {
  return direction === "buy" ? TOKENS.USDC : TOKENS.SOL;
}

export function outputTokenForDirection(direction: SwapDirection): TokenMeta {
  return direction === "buy" ? TOKENS.SOL : TOKENS.USDC;
}

export function sanitizeDecimalInput(value: string, decimals: number): string {
  const stripped = value.replace(/[^0-9.]/g, "");
  const [wholeRaw = "", ...fractionParts] = stripped.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "");

  if (fractionParts.length === 0) return whole;

  const fraction = fractionParts.join("").slice(0, decimals);
  return `${whole}.${fraction}`;
}

export function decimalToRawAmount(
  value: string,
  decimals: number,
): string | null {
  if (!value || value === ".") return null;

  const [wholeRaw = "", fractionRaw = ""] = value.split(".");
  if (!/^\d*$/.test(wholeRaw) || !/^\d*$/.test(fractionRaw)) return null;
  if (fractionRaw.length > decimals) return null;

  const whole = wholeRaw === "" ? "0" : wholeRaw;
  const paddedFraction = fractionRaw.padEnd(decimals, "0");
  const raw = BigInt(whole + paddedFraction);

  return raw > BigInt(0) ? raw.toString() : null;
}

export function rawToDecimalAmount(
  raw: string | bigint,
  decimals: number,
  maxFractionDigits = decimals,
): string {
  const value = typeof raw === "bigint" ? raw : BigInt(raw);
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = value / scale;
  const fraction = value % scale;

  if (fraction === BigInt(0) || maxFractionDigits === 0) {
    return whole.toString();
  }

  const fractionText = fraction
    .toString()
    .padStart(decimals, "0")
    .slice(0, maxFractionDigits)
    .replace(/0+$/, "");

  return fractionText ? `${whole.toString()}.${fractionText}` : whole.toString();
}

export function formatRawTokenAmount(
  raw: string | null | undefined,
  token: TokenMeta,
): string {
  if (!raw) return "--";
  try {
    return rawToDecimalAmount(raw, token.decimals, token.displayDecimals);
  } catch {
    return "--";
  }
}

export function formatLamports(lamports: string | null | undefined): string {
  if (!lamports) return "--";
  try {
    return rawToDecimalAmount(lamports, TOKENS.SOL.decimals, 4);
  } catch {
    return "--";
  }
}

export function formatIntegerAmount(value: string | null | undefined): string {
  if (!value) return "--";
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export async function fetchQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  signal?: AbortSignal;
}): Promise<QuoteResponse> {
  const query = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    slippageBps: params.slippageBps.toString(),
  });

  return relayFetch<QuoteResponse>(`/api/flowback/quote?${query.toString()}`, {
    signal: params.signal,
  });
}

export async function prepareSwap(params: {
  user: string;
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  minOutputAmount: string;
  maxSlippageBps: number;
}): Promise<PrepareResponse> {
  return relayFetch<PrepareResponse>("/api/flowback/prepare", {
    body: JSON.stringify(params),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function submitIntent(params: {
  prepareId: string;
  signedTx: string;
}): Promise<IntentResponse> {
  return relayFetch<IntentResponse>("/api/flowback/intent", {
    body: JSON.stringify(params),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export function deserializeTransaction(base64: string): VersionedTransaction {
  return VersionedTransaction.deserialize(base64ToBytes(base64));
}

export function serializeTransaction(tx: VersionedTransaction): string {
  return bytesToBase64(tx.serialize());
}

export function subscribeToAuctionStatus(
  auctionId: string,
  onEvent: (event: UserStatusEvent) => void,
  onError?: () => void,
): () => void {
  const socket = new WebSocket(getStatusWsUrl());

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "subscribe", auctionId }));
  });

  socket.addEventListener("message", (message) => {
    const event = parseStatusEvent(message.data);
    if (event && event.auctionId === auctionId) onEvent(event);
  });

  socket.addEventListener("error", () => onError?.());

  return () => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "unsubscribe", auctionId }));
    }
    socket.close();
  };
}

async function relayFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await readJson(response);

  if (!response.ok) {
    throw new RelayRequestError(response.status, payload);
  }

  return payload as T;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function getRelayErrorMessage(status: number, payload: unknown): string {
  if (payload && typeof payload === "object") {
    const body = payload as Record<string, unknown>;
    const reason = body.reason ?? body.message ?? body.error;
    if (typeof reason === "string") return reason;
  }

  return `Relay request failed with status ${status}`;
}

function getStatusWsUrl(): string {
  const configured = process.env.NEXT_PUBLIC_RELAY_WS_URL;
  if (configured) return withStatusPath(configured);

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.hostname}:3002/status`;
  }

  return "ws://localhost:3002/status";
}

function withStatusPath(url: string): string {
  return url.endsWith("/status") ? url : `${url.replace(/\/$/, "")}/status`;
}

function parseStatusEvent(data: unknown): UserStatusEvent | null {
  if (typeof data !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const event = parsed as Record<string, unknown>;

  if (
    event.type === "bundle_submitted" &&
    typeof event.auctionId === "string" &&
    typeof event.bundleId === "string"
  ) {
    return {
      type: "bundle_submitted",
      auctionId: event.auctionId,
      bundleId: event.bundleId,
    };
  }

  if (
    event.type === "cashback_confirmed" &&
    typeof event.auctionId === "string" &&
    typeof event.cashbackLamports === "string" &&
    typeof event.txSignature === "string"
  ) {
    return {
      type: "cashback_confirmed",
      auctionId: event.auctionId,
      cashbackLamports: event.cashbackLamports,
      txSignature: event.txSignature,
    };
  }

  if (
    event.type === "fallback_executed" &&
    typeof event.auctionId === "string" &&
    typeof event.txSignature === "string"
  ) {
    return {
      type: "fallback_executed",
      auctionId: event.auctionId,
      txSignature: event.txSignature,
    };
  }

  if (
    event.type === "auction_failed" &&
    typeof event.auctionId === "string" &&
    typeof event.reason === "string"
  ) {
    return {
      type: "auction_failed",
      auctionId: event.auctionId,
      reason: event.reason,
    };
  }

  return null;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
