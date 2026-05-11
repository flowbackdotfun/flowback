<p align="center">
  <img src="public/brand/flowback-mark.png" alt="FlowBack" width="80" />
</p>

<h3 align="center">Flowback-Web</h3>

<p align="center">
  Swap interface for FlowBack.
</p>

---

## Overview

The FlowBack frontend provides two core experiences:

- **Swap Interface** (`/swap`) - Connect your wallet, enter a swap, sign the prepared transaction, and watch real-time auction results with cashback confirmation

The swap flow communicates with the relay via REST (quote → prepare → intent) and WebSocket (real-time auction status updates). Users sign a **prepared transaction**, not a freeform message - the relay validates signature-to-message bytes integrity.

---

## Pages

| Route   | Component   | Description                                 |
| ------- | ----------- | ------------------------------------------- |
| `/`     | LandingPage | Marketing page with hero, how-it-works, FAQ |
| `/swap` | SwapCard    | Main swap interface with wallet connection  |

---

## Key Components

| Component       | Description                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `SwapCard`      | Debounced quote fetching, slippage config, multi-step swap flow (quote → prepare → sign → submit) |
| `CashbackToast` | Green slide-in notification on `cashback_confirmed`                                               |
| `Nav`           | Navigation bar with theme toggle, wallet connect, mobile menu                                     |

---

## Environment Variables

```bash
# Solana RPC endpoint (defaults to mainnet-beta if unset)
NEXT_PUBLIC_SOLANA_RPC_URL=http://127.0.0.1:8899

# Relay WebSocket URL for auction status updates
NEXT_PUBLIC_RELAY_WS_URL=ws://localhost:3002

# Documentation site URL
NEXT_PUBLIC_DOCS_URL=http://localhost:3001

# Fork mode flag (relaxes slippage handling for Surfpool)
NEXT_PUBLIC_IS_FORK=true
```

The relay REST URL is hardcoded to `http://localhost:3001` in `lib/flowback-relay.ts`. Update it there for production.

---

## Development

### Prerequisites

- Node.js 20+
- pnpm 10+

### Setup

```bash
cd client
pnpm install
```

### Run

```bash
pnpm dev          # Development server on http://localhost:3000
pnpm build        # Production build
pnpm start        # Serve production build
```

### Wallet Setup (Local Dev)

When running against a local validator (Surfpool), configure your wallet:

1. Open Phantom → Settings → Developer Settings → Solana → Change Network
2. Set custom RPC to `http://127.0.0.1:8899`
3. Airdrop SOL to your wallet:
   ```bash
   solana airdrop 10 <YOUR_WALLET_ADDRESS> --url http://127.0.0.1:8899
   ```

---

## Stack

| Dependency                   | Purpose                               |
| ---------------------------- | ------------------------------------- |
| Next.js 16                   | React framework (App Router)          |
| React 19                     | UI library                            |
| Tailwind CSS v4              | Styling                               |
| shadcn + @base-ui/react      | Component library                     |
| @solana/wallet-adapter-react | Wallet connection (Phantom, Solflare) |
| @solana/web3.js              | Transaction signing and RPC           |
| lucide-react                 | Icons                                 |
| tw-animate-css               | Animations                            |

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx                  Landing page
│   ├── swap/page.tsx             Swap interface
│   └── layout.tsx                Root layout + wallet provider
├── components/
│   ├── flowback/                 Brand components
│   │   ├── swap-card.tsx         Main swap interface
│   │   ├── cashback-toast.tsx    Cashback notification
│   │   ├── nav.tsx               Navigation bar
│   │   ├── landing-page.tsx      Landing orchestrator
│   │   └── sections/             Landing page sections
│   └── ui/                       shadcn component library
├── lib/
│   ├── flowback-relay.ts         Relay API client + types
│   ├── hooks/                    Custom React hooks
│   └── utils.ts                  Tailwind merge utility
├── providers/
│   └── wallet-provider.tsx       Solana wallet adapter setup
└── styles/
    ├── flowback-swap.css         Swap page styles
    └── flowback-surfaces.css     Shared surface styles
```
