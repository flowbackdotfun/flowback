<p align="center">
  <img src="../client/public/brand/flowback-mark.png" alt="FlowBack" width="80" />
</p>

<h3 align="center">Flowback-Docs</h3>

<p align="center">
  Documentation site for FlowBack - built with Fumadocs.
</p>

---

## Overview

The FlowBack docs site provides developer documentation covering:

- **Quick Start** - getting up and running with the SDK
- **How It Works** - auction lifecycle, bundle construction, privacy model
- **API Reference** - relay REST endpoints and WebSocket protocol

Built with [Fumadocs](https://fumadocs.vercel.app/) on Next.js with [Static Export](https://nextjs.org/docs/app/guides/static-exports) configured.

---

## Development

### Prerequisites

- Node.js 20+
- pnpm 10+

### Setup

```bash
cd docs
pnpm install
```

### Run

```bash
pnpm dev          # Development server on http://localhost:3001
pnpm build        # Production build (static export)
pnpm start        # Serve static build
```

---

## Content

Documentation pages are MDX files in `content/docs/`:

```
content/docs/
├── meta.json              Page ordering
├── index.mdx              Landing page
├── quick-start.mdx        Getting started guide
├── how-it-works.mdx       Architecture deep dive
└── api-reference.mdx      REST + WebSocket API docs
```

Add new pages by creating `.mdx` files in `content/docs/` and updating `meta.json` for navigation ordering.

---

## Project Structure

| Path | Description |
|------|-------------|
| `app/docs` | Documentation layout and pages |
| `app/(home)` | Landing page route group |
| `app/api/search/route.ts` | Search API route handler |
| `lib/source.ts` | Content source adapter ([`loader()`](https://fumadocs.dev/docs/headless/source-api)) |
| `lib/layout.shared.tsx` | Shared layout options |
| `source.config.ts` | Fumadocs MDX configuration |

---

## Stack

| Dependency | Purpose |
|-----------|---------|
| Next.js 16 | Framework |
| Fumadocs | Documentation framework (MDX, search, navigation) |
| @orama/orama | Full-text search |
| Mermaid | Diagram rendering |
| Tailwind CSS v4 | Styling |
