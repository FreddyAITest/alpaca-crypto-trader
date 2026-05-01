const API_BASE = "/api";

const HEADERS = {
  "Content-Type": "application/json",
};

// Retry transient errors (502, 503, 429) with exponential backoff
const RETRYABLE_STATUSES = [502, 503, 429];

async function fetchWithRetry(url, options = {}, retries = 3, backoffMs = 1000) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options);
    if (RETRYABLE_STATUSES.includes(res.status) && attempt < retries) {
      const delay = backoffMs * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    return res;
  }
}

export async function fetchAccount() {
  const res = await fetchWithRetry(`${API_BASE}/account`, { headers: HEADERS });
  if (!res.ok) {
    const isTransient = RETRYABLE_STATUSES.includes(res.status);
    const err = new Error(`Account fetch failed: ${res.status}`);
    err.isTransient = isTransient;
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function fetchPositions() {
  const res = await fetchWithRetry(`${API_BASE}/positions`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Positions fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchOrders(status = "open") {
  const res = await fetchWithRetry(`${API_BASE}/orders?status=${status}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Orders fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchActivities(after) {
  const params = new URLSearchParams({ activity_types: "FILL" });
  if (after) params.set("after", after);
  const res = await fetch(`${API_BASE}/account/activities/FILL?${params}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Activities fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchCryptoBars(symbol, timeframe = "1Hour", limit = 100) {
  const end = new Date().toISOString();
  // Calculate start based on timeframe and limit
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
  const res = await fetch(
    `${API_BASE}/crypto/us/bars?symbols=${symbol}&timeframe=${timeframe}&start=${start}&end=${end}&limit=${limit}`,
    { headers: HEADERS }
  );
  if (!res.ok) throw new Error(`Bars fetch failed: ${res.status}`);
  return res.json();
}

export async function submitOrder(symbol, qty, side, type = "market", time_in_force = "gtc") {
  const res = await fetch(`${API_BASE}/orders`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ symbol, qty, side, type, time_in_force }),
  });
  return res.json();
}

export async function cancelOrder(orderId) {
  const res = await fetch(`${API_BASE}/orders/${orderId}`, {
    method: "DELETE",
    headers: HEADERS,
  });
  if (res.status === 204) return { success: true };
  return res.json();
}

export async function fetchPortfolioHistory(period = "1M", timeframe = "1D") {
  const res = await fetch(
    `${API_BASE}/account/portfolio/history?period=${period}&timeframe=${timeframe}`,
    { headers: HEADERS }
  );
  if (!res.ok) throw new Error(`Portfolio history failed: ${res.status}`);
  return res.json();
}

export async function fetchWeeklyPnL() {
  // Fetch 7-day history at 1-day granularity
  const res = await fetch(
    `${API_BASE}/account/portfolio/history?period=1W&timeframe=1D`,
    { headers: HEADERS }
  );
  if (!res.ok) throw new Error(`Weekly P&L failed: ${res.status}`);
  const data = await res.json();
  if (data && data.equity && data.equity.length >= 2) {
    const startEquity = parseFloat(data.equity[0]);
    const endEquity = parseFloat(data.equity[data.equity.length - 1]);
    const pnl = endEquity - startEquity;
    const pnlPct = startEquity > 0 ? (pnl / startEquity) * 100 : 0;
    return { pnl, pnlPct, startEquity, endEquity };
  }
  return { pnl: 0, pnlPct: 0, startEquity: 0, endEquity: 0 };
}

export async function fetchAssets() {
  const res = await fetch(
    `${API_BASE}/assets?status=active&asset_class=crypto`,
    { headers: HEADERS }
  );
  if (!res.ok) throw new Error(`Assets fetch failed: ${res.status}`);
  return res.json();
}

// Health Check API (lightweight, for monitoring)
export async function fetchCronHealth() {
  const res = await fetch(`${API_BASE}/health`, { headers: HEADERS });
  // 503 = unhealthy but still returns JSON
  if (res.status !== 200 && res.status !== 503) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

// Live Prices API (lightweight, for frequent polling)
export async function fetchLivePrices() {
  const res = await fetch(`${API_BASE}/live-prices`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Live prices failed: ${res.status}`);
  return res.json();
}

// Bot API
export async function fetchBotStatus() {
  const res = await fetch(`${API_BASE}/trading-bot/status`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Bot status failed: ${res.status}`);
  return res.json();
}

export async function runBotManual() {
  const res = await fetch(`${API_BASE}/trading-bot/run`, {
    method: "POST",
    headers: HEADERS,
  });
  if (!res.ok) throw new Error(`Bot run failed: ${res.status}`);
  return res.json();
}

export async function fetchCryptoScanner(pairs, timeframe = "1Hour", lookback = 100) {
  const params = new URLSearchParams({ timeframe, lookback: String(lookback) });
  if (pairs) params.set("pairs", pairs);
  const res = await fetch(`${API_BASE}/crypto-scanner?${params}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Scanner failed: ${res.status}`);
  return res.json();
}

export async function fetchCryptoSnapshots(symbols) {
  // symbols is a comma-separated string like "BTC/USD,ETH/USD"
  const res = await fetch(
    `${API_BASE}/crypto/us/snapshots?symbols=${encodeURIComponent(symbols)}`,
    { headers: HEADERS }
  );
  if (!res.ok) throw new Error(`Crypto snapshots failed: ${res.status}`);
  return res.json();
}

export async function fetchAnalytics() {
  const res = await fetch(`${API_BASE}/analytics`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Analytics fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchLearningStatus() {
  const res = await fetch(`${API_BASE}/learning-status`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Learning status failed: ${res.status}`);
  return res.json();
}