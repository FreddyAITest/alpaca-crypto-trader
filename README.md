# Alpaca Crypto Trader

A Netlify-ready paper trading dashboard for crypto using the Alpaca Markets API.

## Features

- **Dashboard Tab** — Account overview, portfolio chart, positions, recent orders, activity
- **Positions Tab** — Detailed table of all open crypto positions with unrealized P&L
- **Orders Tab** — View and cancel open orders
- **Trade Tab** — Quick-select popular cryptos (BTC, ETH, SOL, DOGE, etc.) and place market/limit orders
- **History Tab** — 30-day equity chart and full trade history
- Auto-refreshes every 30 seconds

## Tech Stack

- React 19 + Vite 8
- Tailwind CSS 4
- Recharts (portfolio charts)
- Lucide React (icons)
- Netlify Functions (API proxy to Alpaca)

## Getting Started

```bash
npm install
npm run dev
```

The dev server proxies `/api/*` to Alpaca's paper trading API.

## Environment Variables (Netlify)

Set these in your Netlify site settings:

- `ALPACA_API_KEY` — Your Alpaca paper trading API key
- `ALPACA_SECRET_KEY` — Your Alpaca paper trading secret key

## Netlify Deployment

1. Push this repo to GitHub
2. Connect the repo in Netlify (choose repo)
3. Set environment variables (ALPACA_API_KEY, ALPACA_SECRET_KEY)
4. Deploy — Netlify auto-detects the Vite build

## API Proxy

In development, Vite proxies `/api/*` requests to Alpaca (with auth headers).
In production, Netlify Functions handle the proxy via `netlify/functions/alpaca-proxy.js`.

## Trading Strategy

- Paper trading only (Alpaca paper API)
- Crypto-only trading
- Target: 2-8% daily returns
- Conservative, secured bets — no moonshots