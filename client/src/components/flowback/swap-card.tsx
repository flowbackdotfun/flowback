"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { X } from "lucide-react";
import { Icon } from "./icons";

type SwapDirection = "buy" | "sell";
type TokenSymbol = "SOL" | "USDC";

const BALANCES_CONNECTED: Record<TokenSymbol, string> = {
  SOL: "12.480",
  USDC: "1,840.22",
};

const BALANCES_DISCONNECTED: Record<TokenSymbol, string> = {
  SOL: "—",
  USDC: "—",
};

const SLIPPAGE_PRESETS = [0.1, 0.5, 1];
const JUPITER_SLIPPAGE_MIN = 0.1;
const JUPITER_SLIPPAGE_MAX = 50;
const TOKEN_LOGO_URLS: Record<TokenSymbol, string> = {
  SOL: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png",
  USDC:
    "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
};

function sanitizeAmount(value: string) {
  const stripped = value.replace(/[^0-9.]/g, "");
  const [whole, ...rest] = stripped.split(".");
  return rest.length > 0 ? `${whole}.${rest.join("")}` : whole;
}

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
  slippage,
  setSlippage,
}: {
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
        <span className="v">Jupiter v6</span>
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
                      sanitizeAmount(event.target.value),
                    );
                    if (!Number.isFinite(next)) return;
                    setSlippage(clampSlippage(next));
                  }}
                  placeholder="custom"
                  type="text"
                  value={
                    SLIPPAGE_PRESETS.includes(slippage) ? "" : String(slippage)
                  }
                />
              </div>
              <div className="slippage-note">
                Your transaction reverts if price moves beyond this.
                Allowed range: {JUPITER_SLIPPAGE_MIN}% to{" "}
                {JUPITER_SLIPPAGE_MAX}%. FlowBack&apos;s sealed-bid auction runs
                independently.
              </div>
            </div>
          ) : null}
        </span>
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
  onCashback?: (lamports: number, sig: string) => void;
}) {
  const { connected } = useWallet();
  const [direction, setDirection] = useState<SwapDirection>("buy");
  const [amountIn, setAmountIn] = useState("1");
  const [slippage, setSlippage] = useState(0.5);
  const [walletOpen, setWalletOpen] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [flipping, setFlipping] = useState(false);
  const signatureNonce = useRef(0);
  const flipTimerRef = useRef<number | null>(null);

  const inToken: TokenSymbol = direction === "buy" ? "USDC" : "SOL";
  const outToken: TokenSymbol = direction === "buy" ? "SOL" : "USDC";
  const rate = direction === "buy" ? 0.00671 : 149.04;
  const amount = Number.parseFloat(amountIn) || 0;
  const hasAmount = amount > 0;
  const quote = hasAmount
    ? (amount * rate).toFixed(direction === "buy" ? 6 : 4)
    : "";
  const cashback = hasAmount
    ? Math.round(amount * (direction === "buy" ? 180 : 26800))
    : 0;
  const balances = connected ? BALANCES_CONNECTED : BALANCES_DISCONNECTED;
  const actionLabel = !connected
    ? "Connect Wallet"
    : !hasAmount
      ? "Enter amount"
      : `Swap ${inToken} for ${outToken}`;
  const actionDisabled = connected && (!hasAmount || swapping);

  function flipTokens() {
    if (flipping) return;

    const nextAmountIn = quote;
    setFlipping(true);
    if (flipTimerRef.current) {
      window.clearTimeout(flipTimerRef.current);
    }
    flipTimerRef.current = window.setTimeout(() => {
      setDirection((current) => (current === "buy" ? "sell" : "buy"));
      setAmountIn(nextAmountIn);
      setFlipping(false);
      flipTimerRef.current = null;
    }, 260);
  }

  useEffect(() => {
    return () => {
      if (flipTimerRef.current) {
        window.clearTimeout(flipTimerRef.current);
      }
    };
  }, []);

  async function handleAction() {
    if (!connected) {
      setWalletOpen(true);
      return;
    }
    if (!hasAmount || swapping) return;

    setSwapping(true);
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    setSwapping(false);
    signatureNonce.current += 1;
    onCashback?.(
      cashback,
      `5xCB${signatureNonce.current.toString(36).padStart(6, "0")}`,
    );
  }

  return (
    <>
      <div className="swap-wrap">
        <div className="swap-card">
          <div className="swap-head">
            <h3>Swap</h3>
            <span className="eyebrow-live">Devnet · live</span>
          </div>

          <div className="swap-rows" data-flipping={flipping}>
            <div className="token-row">
              <label className="label" htmlFor="flowback-pay-amount">
                <span>You pay</span>
              </label>
              <div className="body">
                <span className="token-chip">
                  <TokenLogo token={inToken} />
                  {inToken}
                </span>
                <input
                  autoComplete="off"
                  className="token-amount"
                  id="flowback-pay-amount"
                  inputMode="decimal"
                  onChange={(event) =>
                    setAmountIn(sanitizeAmount(event.target.value))
                  }
                  placeholder="0.00"
                  spellCheck={false}
                  type="text"
                  value={amountIn}
                />
              </div>
              <div className="foot">
                <span>Balance: {balances[inToken]}</span>
                {connected ? (
                  <button
                    className="max-btn"
                    onClick={() =>
                      setAmountIn(BALANCES_CONNECTED[inToken].replace(/,/g, ""))
                    }
                    type="button"
                  >
                    Max
                  </button>
                ) : (
                  <span>
                    {hasAmount ? `1 ${inToken} ≈ ${rate} ${outToken}` : ""}
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
                  <TokenLogo token={outToken} />
                  {outToken}
                </span>
                <input
                  className="token-amount"
                  id="flowback-receive-amount"
                  placeholder="—"
                  readOnly
                  type="text"
                  value={quote}
                />
              </div>
              <div className="foot">
                <span>Balance: {balances[outToken]}</span>
                <span>
                  {hasAmount ? `1 ${inToken} ≈ ${rate} ${outToken}` : ""}
                </span>
              </div>
            </div>
          </div>

          <div className="cashback-line">
            <div className="left">
              <span>FlowBack cashback</span>
            </div>
            <div className={`value${hasAmount ? "" : " empty"}`}>
              {hasAmount ? (
                <>
                  ≈ {cashback.toLocaleString("en-US")}
                  <span className="u">lamports</span>
                </>
              ) : (
                "—"
              )}
            </div>
          </div>

          <button
            aria-busy={swapping || undefined}
            aria-disabled={actionDisabled}
            className="btn btn-primary swap-action"
            disabled={actionDisabled}
            onClick={handleAction}
            type="button"
          >
            {swapping ? "Swapping..." : actionLabel}
          </button>
        </div>

        <RouteDetails slippage={slippage} setSlippage={setSlippage} />
      </div>

      {walletOpen ? <WalletModal onClose={() => setWalletOpen(false)} /> : null}
    </>
  );
}
