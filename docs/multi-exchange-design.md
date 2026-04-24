# Multi-Exchange Strategy Framework — Design Document

**Issue:** ELI-42  
**Author:** CTO Agent  
**Date:** 2026-04-24  
**Status:** Proposed

---

## 1. Executive Summary

The trading bot currently uses Alpaca exclusively for both data and execution. This design adds a multi-exchange abstraction layer that enables:

1. **Cross-exchange signal confirmation** — same signal from multiple sources = higher confidence
2. **Arbitrage detection** — price differences between exchanges = risk-free profit
3. **Best execution** — route orders to the exchange with the best price/liquidity
4. **Resilience** — if one exchange API is down, continue trading on others

The framework uses **CCXT** (CryptoCurrency eXchange Trading Library) as the primary integration, with a normalized interface so the trading logic never needs to know which exchange it's talking to.

**Scope**: Paper-trading-safe approaches first. Live trading on additional exchanges is a future milestone.

---

## 2. Exchange Evaluation

### 2.1 CCXT Library Assessment

| Aspect | Assessment |
|--------|-----------|
| **Language** | JavaScript/Node.js (ccxt) + Python (ccxt-python) |
| **Exchanges** | 100+ exchanges supported |
| **API** | Unified API + exchange-specific implicit API |
| **Rate limiting** | Built-in rate limiter per exchange |
| **WebSocket** | Supported via ccxt.pro (separate package, paid) |
| **Size** | ~500KB minified for single exchange, ~5MB for all |
| **Maintenance** | Active, 30K+ GitHub stars, weekly releases |
| **Paper trading** | Most exchanges support sandbox/testnet mode |

**Verdict**: CCXT is the clear choice. It handles all the API differences, rate limiting, and data normalization. Using raw exchange APIs would require maintaining 3-5 separate integrations.

### 2.2 Target Exchanges (Phase 1)

| Exchange | Reason | API Rate Limit | Paper Trading | WebSocket |
|----------|--------|----------------|---------------|-----------|
| **Alpaca** | Current primary | 200 req/min (free) | Yes (sandbox) | Yes (built-in) |
| **Coinbase** | US-regulated, high liquidity | 10 req/sec (public), 8 req/sec (private) | Yes (sandbox) | Yes |
| **Binance** | Largest volume, most pairs | 1200 req/min (weight-based) | Yes (testnet) | Yes |
| **Kraken** | Good USDT pairs, reliable | Varies by endpoint | Yes (staging) | Yes |

**Phase 2** (future): OKX, Bybit, KuCoin, Bitget for broader coverage.

### 2.3 Rate Limit Budget (per 5-minute bot cycle)

| Exchange | Public API Budget | Private API Budget | Notes |
|----------|-------------------|-------------------|-------|
| Alpaca | 16 req | 16 req | Current usage |
| Coinbase | 3000 req | 2400 req | Very generous |
| Binance | 100 req (weight) | 100 req (weight) | Must batch carefully |
| Kraken | ~30 req | ~30 req | Most conservative |

Total data available per cycle: 4 exchanges x ~60 symbols = ~240 price feeds + bar data.

---

## 3. Architecture

### 3.1 Layer Diagram

```
┌──────────────────────────────────────────┐
│         Trading Bot Logic (v5)           │
│  (strategy, risk, execution unchanged)    │
├──────────────────────────────────────────┤
│       Exchange Abstraction Layer         │
│  (unified interface, signal merge)       │
├──────────┬──────────┬──────────┬─────────┤
│ Exchange │ Exchange │ Exchange │Exchange  │
│ Adapter  │ Adapter  │ Adapter │ Adapter  │
│ Alpaca   │ Coinbase │ Binance  │ Kraken   │
├──────────┴──────────┴──────────┴─────────┤
│              CCXT Library                 │
│     (rate limiting, normalization)        │
├──────────────────────────────────────────┤
│    Exchange REST + WebSocket APIs         │
└──────────────────────────────────────────┘
```

### 3.2 Module Structure

```
netlify/functions/lib/
├── exchange/
│   ├── base-adapter.mjs        # Abstract interface definition
│   ├── alpaca-adapter.mjs      # Wraps existing alpaca-client.mjs
│   ├── coinbase-adapter.mjs    # CCXT-based Coinbase adapter
│   ├── binance-adapter.mjs     # CCXT-based Binance adapter
│   ├── kraken-adapter.mjs      # CCXT-based Kraken adapter
│   ├── exchange-manager.mjs    # Orchestrates multiple exchanges
│   ├── arbitrage-detector.mjs  # Cross-exchange price comparison
│   └── signal-merger.mjs       # Merges signals from multiple sources
└── ...
```

---

## 4. Interface Specification

### 4.1 Base Adapter Interface

Every exchange adapter implements this interface:

```typescript
interface ExchangeAdapter {
  // Identity
  readonly exchangeId: string;          // "alpaca" | "coinbase" | "binance" | "kraken"
  readonly displayName: string;         // Human-readable name
  readonly capabilities: {
    spotTrading: boolean;
    marginTrading: boolean;
    paperTrading: boolean;
    websockets: boolean;
  };

  // Market Data
  async fetchTicker(symbol: string): Promise<Ticker>;
  async fetchTickers(symbols: string[]): Promise<Map<string, Ticker>>;
  async fetchOHLCV(symbol: string, timeframe: string, limit: number): Promise<OHLCV[]>;
  async fetchOrderBook(symbol: string, depth?: number): Promise<OrderBook>;

  // Account
  async fetchBalance(): Promise<Balance>;
  async fetchPositions(): Promise<Position[]>;
  async fetchOpenOrders(): Promise<Order[]>;
  async fetchMyTrades(symbol?: string): Promise<Trade[]>;

  // Trading
  async createOrder(params: CreateOrderParams): Promise<OrderResult>;
  async cancelOrder(orderId: string, symbol?: string): Promise<void>;
  async closePosition(symbol: string): Promise<OrderResult>;

  // Rate Limiting
  readonly rateLimiter: RateLimiter;
  async waitForRateLimit(): Promise<void>;

  // Health
  async healthCheck(): Promise<ExchangeHealth>;
}
```

### 4.2 Normalized Data Types

```typescript
interface Ticker {
  symbol: string;           // Normalized: "BTC/USD"
  bid: number;
  ask: number;
  last: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  change24h: number;         // Percentage
  change24hAbs: number;      // Absolute
  timestamp: number;
}

interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface OrderBook {
  symbol: string;
  bids: Array<[number, number]>;  // [price, amount]
  asks: Array<[number, number]>;
  timestamp: number;
}

interface Balance {
  total: Record<string, number>;   // { "USD": 10000, "BTC": 0.5 }
  free: Record<string, number>;
  used: Record<string, number>;
}

interface Position {
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  leverage: number;
}

interface CreateOrderParams {
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  amount: number;
  price?: number;          // Required for limit orders
  stopLoss?: number;
  takeProfit?: number;
  clientOrderId?: string;
}

interface OrderResult {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  type: string;
  amount: number;
  price: number;
  status: "open" | "closed" | "canceled";
  timestamp: number;
}

interface ExchangeHealth {
  status: "healthy" | "degraded" | "down";
  latencyMs: number;
  lastError: string | null;
  lastCheck: number;
  rateLimitRemaining: number;
}
```

### 4.3 Symbol Normalization

Each exchange uses different symbol formats. The framework normalizes:

| Canonical Symbol | Alpaca | Coinbase | Binance | Kraken |
|-----------------|--------|----------|---------|--------|
| BTC/USD | BTC/USD | BTC-USD | BTCUSDT | XXBTZUSD |
| ETH/USD | ETH/USD | ETH-USD | ETHUSDT | XETHZUSD |
| SOL/USD | SOL/USD | SOL-USD | SOLUSDT | SOLUSD |

```javascript
const SYMBOL_MAP = {
  "BTC/USD":  { alpaca: "BTC/USD", coinbase: "BTC-USD", binance: "BTCUSDT", kraken: "XXBTZUSD" },
  "ETH/USD":  { alpaca: "ETH/USD", coinbase: "ETH-USD", binance: "ETHUSDT", kraken: "XETHZUSD" },
  // ... etc
};

function toExchangeSymbol(canonical, exchangeId) {
  return SYMBOL_MAP[canonical]?.[exchangeId] || canonical;
}

function fromExchangeSymbol(exchangeSymbol, exchangeId) {
  // Reverse lookup
  for (const [canonical, map] of Object.entries(SYMBOL_MAP)) {
    if (map[exchangeId] === exchangeSymbol) return canonical;
  }
  return exchangeSymbol;
}
```

---

## 5. Exchange Manager

### 5.1 Data Fetching Strategy

The Exchange Manager coordinates fetching from multiple exchanges efficiently:

```javascript
class ExchangeManager {
  adapters: Map<string, ExchangeAdapter>;
  
  // Fetch prices from ALL exchanges in parallel
  async fetchAllPrices(symbols: string[]): Promise<MultiExchangePrices> {
    const results = {};
    await Promise.allSettled(
      Array.from(this.adapters).map(async ([id, adapter]) => {
        if (adapter.health.status === "down") return;
        try {
          const tickers = await adapter.fetchTickers(
            symbols.map(s => toExchangeSymbol(s, id))
          );
          results[id] = tickers;
        } catch (e) {
          adapter.health.status = "degraded";
        }
      })
    );
    return results;
  }
  
  // Get the best bid/ask across all exchanges
  async getBestPrice(symbol: string): Promise<BestPrice> {
    const prices = await this.fetchAllPrices([symbol]);
    let bestBid = { price: 0, exchange: null };
    let bestAsk = { price: Infinity, exchange: null };
    
    for (const [exId, tickers] of Object.entries(prices)) {
      const sym = toExchangeSymbol(symbol, exId);
      const ticker = tickers[sym];
      if (ticker?.bid > bestBid.price) bestBid = { price: ticker.bid, exchange: exId };
      if (ticker?.ask < bestAsk.price) bestAsk = { price: ticker.ask, exchange: exId };
    }
    
    return { bestBid, bestAsk, spread: bestAsk.price - bestBid.price };
  }
}
```

### 5.2 Cross-Exchange Signal Confirmation

A signal is more confident if multiple exchanges agree:

```javascript
function confirmSignal(signal, multiExchangeData) {
  let confirmations = 1;  // Original signal
  const confirmingExchanges = [signal.exchange || "alpaca"];
  
  for (const [exId, exSignals] of Object.entries(multiExchangeData)) {
    const exSignal = exSignals.find(s => s.symbol === signal.symbol);
    if (exSignal && exSignal.signal === signal.signal) {
      confirmations++;
      confirmingExchanges.push(exId);
    }
  }
  
  // Boost strength based on confirmation count
  const boostFactor = 1 + (confirmations - 1) * 0.15;  // +15% per confirming exchange
  return {
    ...signal,
    strength: Math.min(1, signal.strength * boostFactor),
    confirmations,
    confirmingExchanges,
    crossExchangeConfirmed: confirmations >= 2,
  };
}
```

---

## 6. Arbitrage Detection

### 6.1 Simple Price Arbitrage

Compare prices across exchanges for the same asset:

```javascript
class ArbitrageDetector {
  constructor(private minSpreadPct: number = 0.3) {}  // Minimum spread to be profitable
  
  async detect(symbols: string[], prices: MultiExchangePrices): ArbitrageOpportunity[] {
    const opportunities = [];
    
    for (const symbol of symbols) {
      const quotes = [];  // { exchange, bid, ask }
      for (const [exId, tickers] of Object.entries(prices)) {
        const sym = toExchangeSymbol(symbol, exId);
        const ticker = tickers[sym];
        if (ticker) {
          quotes.push({ exchange: exId, bid: ticker.bid, ask: ticker.ask });
        }
      }
      
      // Find arbitrage: buy at lowest ask, sell at highest bid
      quotes.sort((a, b) => a.ask - b.ask);
      const cheapest = quotes[0];
      quotes.sort((a, b) => b.bid - a.bid);
      const mostExpensive = quotes[0];
      
      if (cheapest && mostExpensive && cheapest.exchange !== mostExpensive.exchange) {
        const spreadPct = ((mostExpensive.bid - cheapest.ask) / cheapest.ask) * 100;
        const netSpreadPct = spreadPct - this.estimateFees(cheapest.exchange, mostExpensive.exchange);
        
        if (netSpreadPct >= this.minSpreadPct) {
          opportunities.push({
            symbol,
            buyExchange: cheapest.exchange,
            buyPrice: cheapest.ask,
            sellExchange: mostExpensive.exchange,
            sellPrice: mostExpensive.bid,
            grossSpreadPct: spreadPct,
            netSpreadPct,
            estimatedProfitPct: netSpreadPct * 0.5,  // Conservative
          });
        }
      }
    }
    
    return opportunities.sort((a, b) => b.netSpreadPct - a.netSpreadPct);
  }
  
  estimateFees(buyExchange, sellExchange): number {
    // Typical taker fees: 0.05-0.1% per exchange
    const FEES = { alpaca: 0.0, coinbase: 0.06, binance: 0.1, kraken: 0.05 };
    return (FEES[buyExchange] || 0.1) + (FEES[sellExchange] || 0.1);
  }
}
```

### 6.2 Arbitrage Execution (Paper Trading Only)

For safety, arbitrage opportunities are logged but NOT executed in Phase 1:

```javascript
// In trading-bot-v5.mjs:
const arbOpportunities = await arbitrageDetector.detect(WATCH_LIST, multiExchangePrices);
for (const opp of arbOpportunities) {
  log(`[ARB] ${opp.symbol}: Buy ${opp.buyExchange}@${opp.buyPrice}, Sell ${opp.sellExchange}@${opp.sellPrice}, net=${opp.netSpreadPct.toFixed(2)}%`);
  // Store for analysis
  await logArbitrage(opp);
  // DO NOT execute in Phase 1
}
```

---

## 7. Alpaca Adapter (Migration)

The existing `alpaca-client.mjs` is wrapped as an adapter:

```javascript
class AlpacaAdapter {
  get exchangeId() { return "alpaca"; }
  get displayName() { return "Alpaca"; }
  
  // Maps existing alpaca-client.mjs functions to the adapter interface
  async fetchTicker(symbol) {
    const snap = await getCryptoSnapshot([toDataSymbol(symbol)]);
    // ... normalize to Ticker interface
  }
  
  async fetchBalance() {
    const account = await getAccount();
    return { total: { USD: parseFloat(account.equity) }, ... };
  }
  
  // ... etc
}
```

This preserves the well-tested Alpaca integration while adding the adapter abstraction.

---

## 8. CCXT Adapter Pattern

New exchanges use CCXT:

```javascript
import ccxt from "ccxt";

class CCXTAdapter {
  #exchange;
  
  constructor(exchangeId, config) {
    const ExchangeClass = ccxt[exchangeId];
    this.#exchange = new ExchangeClass({
      apiKey: config.apiKey,
      secret: config.secret,
      sandbox: config.paperTrading,  // Enables testnet
      enableRateLimit: true,          // CCXT built-in rate limiter
    });
  }
  
  get exchangeId() { return this.#exchange.id; }
  
  async fetchTicker(symbol) {
    await this.#exchange.waitForRateLimit();
    const ticker = await this.#exchange.fetchTicker(toExchangeSymbol(symbol, this.exchangeId));
    return {
      symbol,
      bid: ticker.bid,
      ask: ticker.ask,
      last: ticker.last,
      // ... normalize to Ticker
    };
  }
  
  async fetchOHLCV(symbol, timeframe, limit) {
    const ohlcv = await this.#exchange.fetchOHLCV(
      toExchangeSymbol(symbol, this.exchangeId),
      timeframe, undefined, limit
    );
    return ohlcv.map(([timestamp, open, high, low, close, volume]) => 
      ({ timestamp, open, high, low, close, volume })
    );
  }
  
  // ... implement full interface
}
```

---

## 9. Environment Configuration

New environment variables needed:

```env
# Coinbase
COINBASE_API_KEY=
COINBASE_API_SECRET=
COINBASE_SANDBOX=true

# Binance
BINANCE_API_KEY=
BINANCE_API_SECRET=
BINANCE_TESTNET=true

# Kraken
KRAKEN_API_KEY=
KRAKEN_API_SECRET=
KRAKEN_STAGING=true

# Multi-exchange feature flags
ENABLE_MULTI_EXCHANGE=false          # Master switch
ENABLE_CROSS_EXCHANGE_CONFIRM=false   # Signal confirmation
ENABLE_ARBITRAGE_DETECT=false        # Arbitrage detection
ENABLE_BEST_EXECUTION=false          # Smart order routing (future)
```

---

## 10. Implementation Plan

### Phase 1: Abstraction Layer (Week 1-2)
- Create `exchange/base-adapter.mjs` with interface
- Create `exchange/alpaca-adapter.mjs` wrapping existing client
- Refactor `trading-bot-v5.mjs` to use adapter instead of direct alpaca calls
- All behavior unchanged, just cleaner architecture

### Phase 2: CCXT Integration (Week 3)
- Add `ccxt` npm dependency
- Create `exchange/coinbase-adapter.mjs` via CCXT
- Create `exchange/exchange-manager.mjs` 
- Paper-trading only (sandbox/testnet)

### Phase 3: Cross-Exchange Signals (Week 4)
- Create `exchange/signal-merger.mjs`
- Add cross-exchange confirmation to trading pipeline
- Wire into ML confidence scoring (from ELI-45)

### Phase 4: Arbitrage Detection (Week 5)
- Create `exchange/arbitrage-detector.mjs`
- Log opportunities, do NOT execute
- Add arbitrage stats to dashboard

### Phase 5: Additional Exchanges (Week 6+)
- Add Binance adapter (testnet)
- Add Kraken adapter (staging)
- Best execution routing (future, requires capital on multiple exchanges)

---

## 11. Risk Assessment

| Risk | Mitigation |
|------|-----------|
| CCXT bundle size bloats serverless function | Use tree-shaking: import only needed exchanges, ~5KB each |
| Rate limit exhaustion across exchanges | Built-in CCXT rate limiter + per-exchange budget tracking |
| API key security in Netlify env vars | Use Netlify env vars (encrypted), never commit to git |
| Symbol mapping errors | Comprehensive mapping table + automated validation via fetchMarkets() |
| Paper vs live behavior differences | Paper trading by default, explicit ENABLE_LIVE flag |
| Cross-exchange latency differences | Async parallel fetching, don't block on slow exchanges |
| CCXT package updates breaking | Pin version in package.json, test before upgrade |

---

## 12. Dependencies

| Package | Version | Size | Purpose |
|---------|---------|------|---------|
| ccxt | ^4.0 | ~5MB full, ~5KB per exchange | Exchange API abstraction |
| (existing) @netlify/blobs | - | - | State persistence |
| (existing) @alpaca/alpaca-trade-api | - | - | Alpaca direct API (kept in alpaca-adapter) |

**Note**: CCXT v4 supports tree-shaking. Import only the exchanges we need:

```javascript
import coinbase from 'ccxt/src/coinbase.cjs';  // ~5KB
import binance from 'ccxt/src/binance.cjs';      // ~5KB
```

---

## 13. Success Metrics

| Metric | Baseline (Alpaca only) | Target (Multi-exchange) |
|--------|----------------------|------------------------|
| Signal accuracy | ~50% | 55%+ (cross-confirmed signals) |
| Arbitrage opportunities | 0 | 5-20/day (logged, not executed in P1) |
| Data sources per symbol | 1 | 2-4 |
| Exchange uptime (aggregate) | ~99% | ~99.9% (failover) |
| Execution price improvement | 0% | 0.05-0.1% (best execution in future) |