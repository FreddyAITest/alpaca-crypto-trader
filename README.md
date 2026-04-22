# Alpaca Crypto Trader

A Netlify-ready paper trading dashboard for crypto using the Alpaca Markets API.

## Features

- **Dashboard Tab** — Account overview, portfolio chart, open positions, recent orders, activity
- **Daily & Weekly P&L** — At-a-glance profit/loss for today and the past 7 days
- **Positions Tab** — Detailed table of all open crypto positions with unrealized P&L
- **Orders Tab** — View and cancel open orders
- **Trade Tab** — Quick-select popular cryptos (BTC, ETH, SOL, DOGE, etc.) and place market/limit orders
- **History Tab** — 30-day equity chart and full trade history
- **Risk Management Engine** — Position sizing, daily loss limits (3%), max drawdown (5%), stop-loss/take-profit
- **Trading Strategy Engine** — EMA crossover + RSI + volume confirmation signals
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
2. Connect the repo in Netlify (choose repo → select this repo)
3. Set environment variables (ALPACA_API_KEY, ALPACA_SECRET_KEY)
4. Deploy — Netlify auto-detects the Vite build

## API Proxy

In development, Vite proxies `/api/*` requests to Alpaca (with auth headers).
In production, Netlify Functions handle the proxy via `netlify/functions/alpaca-proxy.js`.

## Project Structure

```
├── src/
│   ├── App.jsx                  # Main dashboard with tabs
│   ├── api.js                   # Frontend API client
│   ├── index.css                # Tailwind + custom styles
│   └── components/
│       ├── PositionsTable.jsx   # Open positions grid
│       ├── OrdersTable.jsx      # Orders with cancel
│       ├── PnLChart.jsx         # Portfolio equity chart
│       ├── TradePanel.jsx       # Quick trade form
│       └── ActivityLog.jsx      # Trade history feed
├── netlify/
│   └── functions/
│       ├── alpaca-proxy.js      # API proxy (catch-all /api/*)
│       └── lib/
│           ├── alpaca-client.js # Shared Alpaca API client
│           ├── risk-manager.js  # Risk management engine
│           └── strategy.js     # EMA/RSI/Volume strategy
├── netlify.toml                 # Build + function config
└── vite.config.js               # Dev proxy setup
```

## Trading Strategy

- Paper trading only (Alpaca paper API)
- Crypto-only trading
- Target: 2-8% daily returns
- Conservative, secured bets — no moonshots
- Max 10% of equity per position
- 2% stop-loss, 4% take-profit (2:1 R:R)
- 3% daily loss limit — stops trading if hit
- 8% daily profit target — secures profits