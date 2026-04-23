// Shared Alpaca API client for Netlify Functions
// Uses environment variables: ALPACA_API_KEY, ALPACA_SECRET_KEY

const ALPACA_API_KEY = process.env.ALPACA_API_KEY || "PKFJY5TRMF36BGN76LPRGRUKTO";
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY || "";
const ALPACA_BASE = "https://paper-api.alpaca.markets/v2";
const ALPACA_DATA_BASE = "https://data.alpaca.markets/v1beta3";

const headers = {
  "APCA-API-KEY-ID": ALPACA_API_KEY,
  "APCA-API-SECRET-KEY": ALPACA_SECRET_KEY,
  "Content-Type": "application/json",
};

async function alpacaFetch(url, options = {}) {
  const resp = await fetch(url, { headers, ...options });
  if (resp.status === 204) return null;
  const data = await resp.json();
  if (resp.status >= 400) {
    throw new Error(`Alpaca API error ${resp.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

// Account
export async function getAccount() {
  return alpacaFetch(`${ALPACA_BASE}/account`);
}

// Positions
export async function getPositions() {
  return alpacaFetch(`${ALPACA_BASE}/positions`);
}

export async function closePosition(symbol) {
  return alpacaFetch(`${ALPACA_BASE}/positions/${symbol}`, { method: "DELETE" });
}

// Orders
export async function getOrders(status = "open") {
  return alpacaFetch(`${ALPACA_BASE}/orders?status=${status}`);
}

export async function submitOrder(order) {
  return alpacaFetch(`${ALPACA_BASE}/orders`, {
    method: "POST",
    body: JSON.stringify(order),
  });
}

export async function cancelOrder(orderId) {
  return alpacaFetch(`${ALPACA_BASE}/orders/${orderId}`, { method: "DELETE" });
}

export async function getOrder(orderId) {
  return alpacaFetch(`${ALPACA_BASE}/orders/${orderId}`);
}

// Portfolio history
export async function getPortfolioHistory(period = "1D", timeframe = "1Hr") {
  return alpacaFetch(
    `${ALPACA_BASE}/account/portfolio/history?period=${period}&timeframe=${timeframe}`
  );
}

// Activities
export async function getActivities(after) {
  const params = new URLSearchParams({ activity_types: "FILL" });
  if (after) params.set("after", after);
  return alpacaFetch(`${ALPACA_BASE}/account/activities/FILL?${params}`);
}

// Crypto data (bars)
export async function getCryptoBars(symbols, timeframe = "1Hour", limit = 100) {
  const end = new Date().toISOString();
  // Calculate start based on limit and timeframe
  let msPerBar;
  switch (timeframe) {
    case "1Min": msPerBar = 60000; break;
    case "5Min": msPerBar = 300000; break;
    case "15Min": msPerBar = 900000; break;
    case "1Hour": msPerBar = 3600000; break;
    case "1Day": msPerBar = 86400000; break;
    default: msPerBar = 3600000;
  }
  const start = new Date(Date.now() - limit * msPerBar).toISOString();
  
  const symbolList = Array.isArray(symbols) ? symbols.join(",") : symbols;
  return alpacaFetch(
    `${ALPACA_DATA_BASE}/crypto/us/bars?symbols=${symbolList}&timeframe=${timeframe}&start=${start}&end=${end}&limit=${limit}`
  );
}

// Crypto snapshot (current prices)
export async function getCryptoSnapshot(symbols) {
  const symbolList = Array.isArray(symbols) ? symbols.join(",") : symbols;
  return alpacaFetch(
    `${ALPACA_DATA_BASE}/crypto/us/snapshots?symbols=${symbolList}`
  );
}

// Clock
export async function getClock() {
  return alpacaFetch(`${ALPACA_BASE}/clock`);
}

// Symbol format helpers
// Data API expects "BTC/USD" format (with slash)
// Trade API expects "BTCUSD" format (no slash)
export function toDataSymbol(symbol) {
  // Ensure symbol has slash: "BTC/USD" or insert before "USD"
  if (symbol.includes("/")) return symbol;
  return symbol.replace("USD", "/USD");
}

export function toTradeSymbol(symbol) {
  // Remove slash for order API: "BTC/USD" -> "BTCUSD"
  return symbol.replace("/", "");
}

// Stock data (for stock scanner)
export async function getStockSnapshot(symbols) {
  const symbolList = Array.isArray(symbols) ? symbols.join(",") : symbols;
  return alpacaFetch(
    `${ALPACA_DATA_BASE}/stocks/us/snapshots?symbols=${symbolList}`
  );
}

export async function getStockBars(symbols, timeframe = "1Hour", limit = 100) {
  const end = new Date().toISOString();
  let msPerBar;
  switch (timeframe) {
    case "1Min": msPerBar = 60000; break;
    case "5Min": msPerBar = 300000; break;
    case "15Min": msPerBar = 900000; break;
    case "1Hour": msPerBar = 3600000; break;
    case "1Day": msPerBar = 86400000; break;
    default: msPerBar = 3600000;
  }
  const start = new Date(Date.now() - limit * msPerBar).toISOString();
  const symbolList = Array.isArray(symbols) ? symbols.join(",") : symbols;
  return alpacaFetch(
    `${ALPACA_DATA_BASE}/stocks/us/bars?symbols=${symbolList}&timeframe=${timeframe}&start=${start}&end=${end}&limit=${limit}`
  );
}

export async function isMarketOpen() {
  const clock = await getClock();
  return clock.is_open;
}

export { ALPACA_BASE, ALPACA_DATA_BASE, alpacaFetch };