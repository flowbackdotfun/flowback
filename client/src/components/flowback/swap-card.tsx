"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { X } from "lucide-react";
import {
  decimalToRawAmount,
  deserializeTransaction,
  fetchQuote,
  formatLamports,
  formatRawTokenAmount,
  inputTokenForDirection,
  outputTokenForDirection,
  prepareSwap,
  rawToDecimalAmount,
  sanitizeDecimalInput,
  serializeTransaction,
  submitIntent,
  subscribeToAuctionStatus,
  TOKENS,
  type JupiterQuote,
  type QuoteResponse,
  type SwapDirection,
  type TokenSymbol,
} from "@/lib/flowback-relay";

const SLIPPAGE_PRESETS = [0.1, 0.5, 1];
const JUPITER_SLIPPAGE_MIN = 0.1;
const JUPITER_SLIPPAGE_MAX = 50;
const SOL_FEE_RESERVE_LAMPORTS = BigInt(10_000_000);
const QUOTE_DEBOUNCE_MS = 350;
const STATUS_TIMEOUT_MS = 90_000;
const TOKEN_LOGO_URLS: Record<TokenSymbol, string> = {
  SOL: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png",
  USDC: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
};

type QuoteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: QuoteResponse }
  | { status: "error"; message: string };

type BalanceState = {
  loading: boolean;
  values: Record<TokenSymbol, string | null>;
};

type StatusState = {
  tone: "info" | "success" | "error";
  message: string;
  signature?: string;
};

type ParsedTokenAccount = {
  parsed?: {
    info?: {
      tokenAmount?: {
        amount?: string;
      };
    };
  };
};

const EMPTY_BALANCES: Record<TokenSymbol, string | null> = {
  SOL: null,
  USDC: null,
};

function clampSlippage(value: number) {
  return Math.min(JUPITER_SLIPPAGE_MAX, Math.max(JUPITER_SLIPPAGE_MIN, value));
}

function TokenLogo({ token }: { token: TokenSymbol }) {
  const [imageFailed, setImageFailed] = useState(false);

  if (!imageFailed) {
    return (
      <span className={`token-logo ${token.toLowerCase()}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          className="token-logo-img"
          height={24}
          onError={() => setImageFailed(true)}
          src={TOKEN_LOGO_URLS[token]}
          width={24}
        />
      </span>
    );
  }

  return (
    <span className={`token-logo ${token.toLowerCase()}`}>
      {token === "SOL" ? "S" : "$"}
    </span>
  );
}

function WalletModal({ onClose }: { onClose: () => void }) {
  const { select, wallets } = useWallet();
  const detected = wallets.filter(
    (wallet) =>
      wallet.readyState === "Installed" || wallet.readyState === "Loadable",
  );
  const rest = wallets.filter(
    (wallet) =>
      wallet.readyState !== "Installed" && wallet.readyState !== "Loadable",
  );
  const all = [...detected, ...rest];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="wallet-modal-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        aria-label="Connect wallet"
        className="wallet-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="wallet-modal-head">
          <span>Connect wallet</span>
          <button
            aria-label="Close wallet selector"
            className="wallet-modal-close"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={13} />
          </button>
        </div>

        <div className="wallet-modal-list">
          {all.length === 0 ? (
            <p className="wallet-modal-empty">
              No wallets detected. Install Phantom or Solflare.
            </p>
          ) : (
            all.map((wallet) => (
              <button
                className="wallet-option"
                key={wallet.adapter.name}
                onClick={() => {
                  select(wallet.adapter.name);
                  onClose();
                }}
                type="button"
              >
                {wallet.adapter.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt=""
                    className="wallet-option-icon"
                    height={26}
                    src={wallet.adapter.icon}
                    width={26}
                  />
                ) : null}
                <span>{wallet.adapter.name}</span>
                {wallet.readyState === "Installed" ||
                wallet.readyState === "Loadable" ? (
                  <span className="wallet-option-tag">Detected</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function RouteDetails({
  priceImpact,
  routeLabel,
  slippage,
  setSlippage,
}: {
  priceImpact: string | null;
  routeLabel: string;
  slippage: number;
  setSlippage: (value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const slipRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (slipRef.current && !slipRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="swap-meta">
      <div className="row">
        <span className="k">Route</span>
        <span className="v">{routeLabel}</span>
      </div>
      <div className="row">
        <span className="k">Slippage</span>
        <span className="slippage-anchor" ref={slipRef}>
          <button
            aria-expanded={open}
            aria-haspopup="dialog"
            className="slippage-trigger"
            data-open={open}
            onClick={() => setOpen((current) => !current)}
            type="button"
          >
            {slippage}%
            <svg
              aria-hidden="true"
              className="caret"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              viewBox="0 0 12 12"
            >
              <path d="M3 5l3 3 3-3" />
            </svg>
          </button>

          {open ? (
            <div
              aria-label="Max slippage"
              className="slippage-popover"
              role="dialog"
            >
              <div className="label">Max slippage</div>
              <div className="slippage-presets">
                {SLIPPAGE_PRESETS.map((preset) => (
                  <button
                    className="slip-btn"
                    data-active={slippage === preset}
                    key={preset}
                    onClick={() => setSlippage(clampSlippage(preset))}
                    type="button"
                  >
                    {preset}%
                  </button>
                ))}
                <input
                  aria-label="Custom slippage"
                  className="slip-custom"
                  inputMode="decimal"
                  onChange={(event) => {
                    const next = Number.parseFloat(
                      sanitizeDecimalInput(event.target.value, 2),
                    );
                    if (Number.isFinite(next)) {
                      setSlippage(clampSlippage(next));
                    }
                  }}
                  placeholder="custom"
                  type="text"
                  value={
                    SLIPPAGE_PRESETS.includes(slippage) ? "" : String(slippage)
                  }
                />
              </div>
              <div className="slippage-note">
                Your transaction reverts if price moves beyond this. Allowed
                range: {JUPITER_SLIPPAGE_MIN}% to {JUPITER_SLIPPAGE_MAX}%.
              </div>
            </div>
          ) : null}
        </span>
      </div>
      <div className="row">
        <span className="k">Price impact</span>
        <span className="v">{priceImpact ?? "—"}</span>
      </div>
      <div className="row">
        <span className="k">Auction window</span>
        <span className="v">200ms · sealed bid</span>
      </div>
    </div>
  );
}

export function SwapCard({
  onCashback,
}: {
  onCashback?: (lamports: string, sig: string) => void;
}) {
  const { connection } = useConnection();
  const { connected, publicKey, signTransaction } = useWallet();
  const [direction, setDirection] = useState<SwapDirection>("buy");
  const [amountIn, setAmountIn] = useState("1");
  const [slippage, setSlippage] = useState(0.5);
  const [walletOpen, setWalletOpen] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [flipping, setFlipping] = useState(false);
  const [quoteState, setQuoteState] = useState<QuoteState>({ status: "idle" });
  const [balances, setBalances] = useState<BalanceState>({
    loading: false,
    values: EMPTY_BALANCES,
  });
  const [status, setStatus] = useState<StatusState | null>(null);
  const flipTimerRef = useRef<number | null>(null);
  const statusCleanupRef = useRef<(() => void) | null>(null);
  const statusTimeoutRef = useRef<number | null>(null);

  const inputToken = inputTokenForDirection(direction);
  const outputToken = outputTokenForDirection(direction);
  const amountRaw = useMemo(
    () => decimalToRawAmount(amountIn, inputToken.decimals),
    [amountIn, inputToken.decimals],
  );
  const hasAmount = amountRaw !== null;
  const slippageBps = Math.round(slippage * 100);
  const activeQuote =
    quoteState.status === "ready" ? quoteState.data.quote : null;
  const cashbackEstimate =
    quoteState.status === "ready"
      ? (quoteState.data.cashbackEstimate?.lamports ?? null)
      : null;
  const quoteDisplay = activeQuote
    ? formatRawTokenAmount(activeQuote.outAmount, outputToken)
    : quoteState.status === "loading"
      ? "Fetching..."
      : "";
  const routeLabel = activeQuote ? getRouteLabel(activeQuote) : "Jupiter";
  const priceImpact = activeQuote
    ? formatPriceImpact(activeQuote.priceImpactPct)
    : null;
  const actionDisabled =
    connected &&
    (swapping ||
      !hasAmount ||
      quoteState.status !== "ready" ||
      !signTransaction);
  const actionLabel = getActionLabel({
    connected,
    hasAmount,
    quoteState,
    signTransaction: Boolean(signTransaction),
    swapping,
    inputToken: inputToken.symbol,
    outputToken: outputToken.symbol,
  });

  const clearAuctionWatch = useCallback(() => {
    statusCleanupRef.current?.();
    statusCleanupRef.current = null;
    if (statusTimeoutRef.current) {
      window.clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = null;
    }
  }, []);

  const refreshBalances = useCallback(async () => {
    if (!publicKey) return;

    setBalances((current) => ({ ...current, loading: true }));
    const [solResult, usdcResult] = await Promise.allSettled([
      connection.getBalance(publicKey, "confirmed"),
      connection.getParsedTokenAccountsByOwner(
        publicKey,
        { mint: new PublicKey(TOKENS.USDC.mint) },
        "confirmed",
      ),
    ]);

    const solRaw =
      solResult.status === "fulfilled" ? solResult.value.toString() : null;

    let usdcRaw: string | null = null;
    if (usdcResult.status === "fulfilled") {
      let total = BigInt(0);
      for (const account of usdcResult.value.value) {
        const amount = (account.account.data as ParsedTokenAccount).parsed?.info
          ?.tokenAmount?.amount;
        if (amount) total += BigInt(amount);
      }
      usdcRaw = total.toString();
    }

    setBalances({
      loading: false,
      values: {
        SOL: solRaw,
        USDC: usdcRaw,
      },
    });
  }, [connection, publicKey]);

  useEffect(() => {
    if (!connected || !publicKey) {
      setBalances({ loading: false, values: EMPTY_BALANCES });
      return;
    }

    void refreshBalances();
  }, [connected, publicKey, refreshBalances]);

  useEffect(() => {
    if (!amountRaw) {
      setQuoteState({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setQuoteState({ status: "loading" });
      fetchQuote({
        inputMint: inputToken.mint,
        outputMint: outputToken.mint,
        amount: amountRaw,
        slippageBps,
        signal: controller.signal,
      })
        .then((data) => setQuoteState({ status: "ready", data }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setQuoteState({
            status: "error",
            message: getErrorMessage(error, "Quote unavailable"),
          });
        });
    }, QUOTE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [amountRaw, inputToken.mint, outputToken.mint, slippageBps]);

  useEffect(() => {
    return () => {
      clearAuctionWatch();
      if (flipTimerRef.current) window.clearTimeout(flipTimerRef.current);
    };
  }, [clearAuctionWatch]);

  function flipTokens() {
    if (flipping) return;

    const nextAmountIn = activeQuote
      ? rawToDecimalAmount(
          activeQuote.outAmount,
          outputToken.decimals,
          outputToken.decimals,
        )
      : "";

    setFlipping(true);
    if (flipTimerRef.current) {
      window.clearTimeout(flipTimerRef.current);
    }
    flipTimerRef.current = window.setTimeout(() => {
      setDirection((current) => (current === "buy" ? "sell" : "buy"));
      setAmountIn(nextAmountIn);
      setStatus(null);
      setFlipping(false);
      flipTimerRef.current = null;
    }, 260);
  }

  function handleAmountChange(event: ChangeEvent<HTMLInputElement>) {
    setAmountIn(sanitizeDecimalInput(event.target.value, inputToken.decimals));
    setStatus(null);
  }

  function setMaxAmount() {
    const raw = balances.values[inputToken.symbol];
    const spendable = getSpendableAmountRaw(raw, inputToken.symbol);
    if (spendable === null) return;

    setAmountIn(
      rawToDecimalAmount(spendable, inputToken.decimals, inputToken.decimals),
    );
    console.log(
      "Value: ",
      rawToDecimalAmount(spendable, inputToken.decimals, inputToken.decimals),
    );
    setStatus(null);
  }

  console.log({ wallet: publicKey?.toBase58(), rpc: connection.rpcEndpoint });

  const canUseMax = useMemo(() => {
    const spendable = getSpendableAmountRaw(
      balances.values[inputToken.symbol],
      inputToken.symbol,
    );
    return !balances.loading && spendable !== null && spendable > BigInt(0);
  }, [balances.loading, balances.values, inputToken.symbol]);

  async function handleAction() {
    if (!connected) {
      setWalletOpen(true);
      return;
    }
    if (
      !publicKey ||
      !signTransaction ||
      !amountRaw ||
      quoteState.status !== "ready" ||
      swapping
    ) {
      return;
    }

    const quote = quoteState.data.quote;
    if (quote.inAmount !== amountRaw) {
      setStatus({ tone: "error", message: "Quote is stale. Try again." });
      return;
    }

    clearAuctionWatch();
    setSwapping(true);
    setStatus({ tone: "info", message: "Preparing transaction..." });

    try {
      const prepared = await prepareSwap({
        user: publicKey.toBase58(),
        inputMint: inputToken.mint,
        outputMint: outputToken.mint,
        inputAmount: quote.inAmount,
        minOutputAmount: quote.otherAmountThreshold,
        maxSlippageBps: slippageBps,
      });

      const transaction = deserializeTransaction(prepared.unsignedTx);
      setStatus({ tone: "info", message: "Approve the swap in your wallet." });
      const signed = await signTransaction(transaction);

      setStatus({ tone: "info", message: "Simulating transaction..." });
      const simulation = await connection.simulateTransaction(signed, {
        commitment: "processed",
        replaceRecentBlockhash: false,
        sigVerify: true,
      });

      if (simulation.value.err) {
        throw new Error("Simulation failed. Refresh the quote and try again.");
      }

      setStatus({ tone: "info", message: "Submitting intent..." });
      const intent = await submitIntent({
        prepareId: prepared.prepareId,
        signedTx: serializeTransaction(signed),
      });

      setStatus({
        tone: "info",
        message: "Auction pending. Waiting for relay status...",
      });

      statusCleanupRef.current = subscribeToAuctionStatus(
        intent.auctionId,
        (event) => {
          if (event.type === "bundle_submitted") {
            setStatus({
              tone: "info",
              message: "Bundle submitted. Waiting for cashback...",
            });
            return;
          }

          clearAuctionWatch();
          setSwapping(false);
          void refreshBalances();

          if (event.type === "fallback_executed") {
            setStatus({
              tone: "success",
              message: "Swap submitted without cashback this time.",
              signature: event.txSignature,
            });
            return;
          }

          setStatus({
            tone: "success",
            message: "Cashback confirmed.",
            signature: event.txSignature,
          });
          onCashback?.(event.cashbackLamports, event.txSignature);
        },
        () => {
          setStatus({
            tone: "error",
            message: "Status stream disconnected. Check wallet activity.",
          });
        },
      );

      statusTimeoutRef.current = window.setTimeout(() => {
        clearAuctionWatch();
        setSwapping(false);
        setStatus({
          tone: "info",
          message: "Intent submitted. Confirmation is still pending.",
        });
      }, STATUS_TIMEOUT_MS);
    } catch (error) {
      clearAuctionWatch();
      setSwapping(false);
      setStatus({
        tone: "error",
        message: getErrorMessage(error, "Swap failed. Try again."),
      });
    }
  }

  return (
    <>
      <div className="swap-wrap">
        <div className="swap-card">
          <div className="swap-head">
            <h3>Swap</h3>
            {/* <span className="eyebrow-live">Mainnet · live</span> */}
          </div>

          <div className="swap-rows" data-flipping={flipping}>
            <div className="token-row">
              <label className="label" htmlFor="flowback-pay-amount">
                <span>You pay</span>
              </label>
              <div className="body">
                <span className="token-chip">
                  <TokenLogo token={inputToken.symbol} />
                  {inputToken.symbol}
                </span>
                <input
                  autoComplete="off"
                  className="token-amount"
                  id="flowback-pay-amount"
                  inputMode="decimal"
                  onChange={handleAmountChange}
                  placeholder="0.00"
                  spellCheck={false}
                  type="text"
                  value={amountIn}
                />
              </div>
              <div className="foot">
                <span>
                  Balance:{" "}
                  {formatBalanceLabel(connected, balances, inputToken.symbol)}
                </span>
                {connected ? (
                  <button
                    className="max-btn"
                    disabled={!canUseMax}
                    onClick={setMaxAmount}
                    type="button"
                  >
                    Max
                  </button>
                ) : (
                  <span>
                    {quoteState.status === "ready" ? "Quote ready" : ""}
                  </span>
                )}
              </div>
            </div>

            <button
              aria-label="Flip direction"
              className="swap-flip"
              data-flipping={flipping}
              onClick={flipTokens}
              type="button"
            >
              <svg
                aria-hidden="true"
                fill="none"
                height="16"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
                width="16"
              >
                <path d="M7 4v14M7 18l-3-3M7 18l3-3M17 20V6M17 6l-3 3M17 6l3 3" />
              </svg>
            </button>

            <div className="token-row">
              <label className="label" htmlFor="flowback-receive-amount">
                <span>You receive</span>
              </label>
              <div className="body">
                <span className="token-chip">
                  <TokenLogo token={outputToken.symbol} />
                  {outputToken.symbol}
                </span>
                <input
                  className="token-amount"
                  id="flowback-receive-amount"
                  placeholder="—"
                  readOnly
                  type="text"
                  value={quoteDisplay}
                />
              </div>
              <div className="foot">
                <span>
                  Balance:{" "}
                  {formatBalanceLabel(connected, balances, outputToken.symbol)}
                </span>
                <span>{getQuoteFootnote(quoteState)}</span>
              </div>
            </div>
          </div>

          <div className="cashback-line">
            <div className="left">
              <span>FlowBack cashback</span>
            </div>
            <div className={`value${hasAmount ? "" : " empty"}`}>
              {getCashbackLabel(quoteState.status, cashbackEstimate)}
            </div>
          </div>

          {quoteState.status === "error" ? (
            <p className="swap-state error" role="alert">
              {quoteState.message}
            </p>
          ) : null}

          {status ? (
            <p className={`swap-state ${status.tone}`} role="status">
              {status.message}
              {status.signature ? (
                <>
                  {" "}
                  <a
                    href={`https://explorer.solana.com/tx/${status.signature}`}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    View transaction
                  </a>
                </>
              ) : null}
            </p>
          ) : null}

          <button
            aria-busy={swapping || undefined}
            aria-disabled={actionDisabled}
            className="btn btn-primary swap-action"
            disabled={actionDisabled}
            onClick={handleAction}
            type="button"
          >
            {actionLabel}
          </button>
        </div>

        <RouteDetails
          priceImpact={priceImpact}
          routeLabel={routeLabel}
          setSlippage={setSlippage}
          slippage={slippage}
        />
      </div>

      {walletOpen ? <WalletModal onClose={() => setWalletOpen(false)} /> : null}
    </>
  );
}

function getActionLabel({
  connected,
  hasAmount,
  inputToken,
  outputToken,
  quoteState,
  signTransaction,
  swapping,
}: {
  connected: boolean;
  hasAmount: boolean;
  inputToken: TokenSymbol;
  outputToken: TokenSymbol;
  quoteState: QuoteState;
  signTransaction: boolean;
  swapping: boolean;
}) {
  if (!connected) return "Connect Wallet";
  if (!hasAmount) return "Enter amount";
  if (!signTransaction) return "Wallet cannot sign";
  if (swapping) return "Swapping...";
  if (quoteState.status === "loading") return "Getting quote...";
  if (quoteState.status === "error") return "Quote unavailable";
  if (quoteState.status !== "ready") return "Get quote";
  return `Swap ${inputToken} for ${outputToken}`;
}

function formatBalanceLabel(
  connected: boolean,
  balances: BalanceState,
  token: TokenSymbol,
) {
  if (!connected) return "—";
  if (balances.loading) return "Loading";
  return formatRawTokenAmount(balances.values[token], TOKENS[token]);
}

function getQuoteFootnote(quoteState: QuoteState) {
  if (quoteState.status === "loading") return "Fetching quote";
  if (quoteState.status === "ready") {
    return quoteState.data.quote.timeTaken
      ? `${Math.round(quoteState.data.quote.timeTaken * 1000)}ms`
      : "Jupiter";
  }
  if (quoteState.status === "error") return "Quote failed";
  return "";
}

function getCashbackLabel(
  status: QuoteState["status"],
  cashbackLamports: string | null,
) {
  if (status === "loading") return "Estimating";
  if (status === "error") return "Unavailable";
  if (!cashbackLamports) return "—";
  const cashbackSol = formatLamports(cashbackLamports);

  return (
    <>
      ≈ {cashbackSol}
      <span className="u">SOL</span>
    </>
  );
}

function getRouteLabel(quote: JupiterQuote) {
  const hops = quote.routePlan.length;
  if (hops === 0) return "Jupiter";
  return `Jupiter · ${hops} ${hops === 1 ? "hop" : "hops"}`;
}

function formatPriceImpact(value: string) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return "—";
  if (parsed > 0 && parsed < 0.01) return "<0.01%";
  return `${parsed.toFixed(2)}%`;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function maxBigInt(a: bigint, b: bigint) {
  return a > b ? a : b;
}

function getSpendableAmountRaw(
  raw: string | null,
  token: TokenSymbol,
): bigint | null {
  if (!raw) return null;
  try {
    const value = BigInt(raw);
    if (token === "SOL") {
      return maxBigInt(BigInt(0), value - SOL_FEE_RESERVE_LAMPORTS);
    }
    return value;
  } catch {
    return null;
  }
}
