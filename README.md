# 🚀 Alpaca Crypto Trader

A Netlify-ready paper trading dashboard for crypto using the Alpaca Markets API.

## Features

- **Portfolio Dashboard** — Real-time account value, cash balance, daily P&L, and open positions
- **Positions View** — Detailed table of all open crypto positions with unrealized P&L
- **Orders Management** — View, place, and cancel orders
- **Trade Panel** — Quick-select popular cryptos (BTC, ETH, SOL, DOGE, etc.) and place market/limit orders
- **Portfolio History Chart** — 30-day equity chart powered by Recharts
- **Activity Log** — Recent fill history

## Tech Stack

- React 19 + Vite 8
- Tailwind CSS 4
- Recharts (for portfolio charts)
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
2. Connect the repo in Netlify
3. Set environment variables
4. Deploy — Netlify will auto-detect the Vite build

## API Proxy

In development, Vite proxies `/api/*` requests to Alpaca.
In production, Netlify Functions handle the proxy via `netlify/functions/alpaca-proxy.js`.

## Trading Strategy

- Paper trading only (Alpaca paper API)
- Crypto-only trading
- Target: 2-8% daily returns
- Conservative, secured bets — no moonshots

## Project Structure

```
src/
  api.js                    # Alpaca API client
  App.jsx                   # Main app with tabs
  components/
    AccountCard.jsx         # Portfolio metric cards
    PositionsTable.jsx      # Open positions table
    OrdersTable.jsx         # Orders table with cancel
    PnLChart.jsx            # Portfolio history chart
    TradePanel.jsx          # Trade entry form
    ActivityLog.jsx        # Recent fills
netlify/
  functions/
    alpaca-proxy.js         # Netlify serverless API proxy
```