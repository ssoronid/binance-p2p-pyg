# PYG P2P — USDT ↔ PYG calculator

Next.js app that quotes **USDT / PYG** on Binance P2P using **trusted merchants only** (`publisherType: merchant`).

## Features

- Live quotes from Binance public P2P search API (no API key)
- Trusted / verified merchants filter
- Calculator: USDT → PYG (sell USDT) or PYG → USDT (buy USDT)
- Fills across the order book when one ad cannot cover the full amount
- Ready to deploy on Vercel

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Quote API

```
GET /api/quote?amount=100&side=SELL&mode=usdt_to_pyg&trusted=1
```

| Param     | Values                         | Meaning                                      |
|-----------|--------------------------------|----------------------------------------------|
| `amount`  | positive number                | Input amount                                 |
| `side`    | `SELL` \| `BUY`                | Your action on USDT                          |
| `mode`    | `usdt_to_pyg` \| `pyg_to_usdt` | Which unit `amount` is in                    |
| `trusted` | `1` (default) \| `0`           | Merchant-only filter                         |

`side=SELL` + `mode=usdt_to_pyg` → “I have X USDT, how much PYG do I get?”

## Deploy on Vercel

```bash
npx vercel
```

Or push to GitHub and import the repo in the Vercel dashboard. No env vars required for public P2P reads.

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- Server route proxies Binance so the browser is not blocked by CORS
