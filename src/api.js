const API_BASE = "/api";

const HEADERS = {
  "Content-Type": "application/json",
};

export async function fetchAccount() {
  const res = await fetch(`${API_BASE}/account`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Account fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchPositions() {
  const res = await fetch(`${API_BASE}/positions`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Positions fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchOrders(status = "open") {
  const res = await fetch(`${API_BASE}/orders?status=${status}`, { headers: HEADERS });
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

export async function fetchCryptoBars(symbol, timeframe = "1Day", limit = 7) {
  const end = new Date().toISOString();
  const start = new Date(Date.now() - limit * 86400000).toISOString();
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

export async function fetchAssets() {
  const res = await fetch(
    `${API_BASE}/assets?status=active&asset_class=crypto`,
    { headers: HEADERS }
  );
  if (!res.ok) throw new Error(`Assets fetch failed: ${res.status}`);
  return res.json();
}