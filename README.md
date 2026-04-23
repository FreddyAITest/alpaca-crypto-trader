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

## Netlify Deployment — Step by Step

### Step 1: Push repo to GitHub

The repo is already pushed to: https://github.com/FreddyAITest/alpaca-crypto-trader

If you need to re-push:
```bash
git remote add origin https://github.com/FreddyAITest/alpaca-crypto-trader.git
git push -u origin main
```

### Step 2: Connect Netlify to GitHub

1. Go to https://app.netlify.com/start
2. Click "Import an existing project from a Git repository"
3. Choose "GitHub" as the provider
4. Authorize Netlify to access your GitHub (if first time)
5. Select the `FreddyAITest/alpaca-crypto-trader` repository
6. Build settings (auto-detected):
   - Build command: `npm run build`
   - Publish directory: `dist`
7. Click "Deploy site"

### Step 3: Set Environment Variables (CRITICAL)

Without these, all Alpaca API calls will return **401 Unauthorized**.

1. Go to your Netlify site dashboard
2. Click **Site settings** (top nav)
3. Click **Environment variables** (left sidebar)
4. Click **Add a variable** and add:

| Variable | Value | Notes |
|----------|-------|-------|
| `ALPACA_API_KEY` | `PKFJY5TRMF36BGN76LPRGRUKTO` | Your paper trading API key |
| `ALPACA_SECRET_KEY` | *(your secret key)* | Find this at https://app.alpaca.markets/paper/dashboard/overview → API Keys tab |

**How to find your Alpaca Secret Key:**
1. Go to https://app.alpaca.markets/paper/dashboard/overview
2. Click the **API Keys** tab on the left
3. You'll see your Key ID (already known) and the Secret Key
4. If you don't see the secret, click "Regenerate" to create a new key pair
5. Copy the secret key value and paste it into the Netlify env var

### Step 4: Trigger a deploy

After adding environment variables, you need to redeploy:
1. Go to **Deploys** tab in Netlify
2. Click **Trigger deploy** → **Deploy site**
3. Wait for the build to complete

Your site is now live! The serverless proxy function will authenticate with Alpaca using the env vars.

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
- 8% daily profit target — secures profits# Build check - Thu Apr 23 05:25:27 PM UTC 2026
