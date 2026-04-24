// Alpaca API Proxy - Netlify Function v2 (ESM)
// Proxies requests to Alpaca paper trading API and crypto data API
// Uses environment variables: ALPACA_API_KEY, ALPACA_SECRET_KEY
// Includes retry logic for transient errors (502, 503, 429)

const ALPACA_API_KEY = process.env.ALPACA_API_KEY || "";
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY || "";
const ALPACA_BASE = "https://paper-api.alpaca.markets/v2";
const ALPACA_DATA_BASE = "https://data.alpaca.markets/v1beta3";

const RETRYABLE_STATUSES = [502, 503, 429];
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const resp = await fetch(url, options);
    if (RETRYABLE_STATUSES.includes(resp.status) && attempt < retries) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    return resp;
  }
}

export default async (req) => {
  // Check credentials are available
  if (!ALPACA_API_KEY || !ALPACA_SECRET_KEY) {
    return new Response(JSON.stringify({
      error: "Alpaca API credentials not configured. Set ALPACA_API_KEY and ALPACA_SECRET_KEY environment variables."
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const headers = {
    "APCA-API-KEY-ID": ALPACA_API_KEY,
    "APCA-API-SECRET-KEY": ALPACA_SECRET_KEY,
    "Content-Type": "application/json",
  };

  const url = new URL(req.url);
  const path = url.pathname.replace("/api/", "");

  // Skip bot routes - they're handled by dedicated functions
  if (path.startsWith("trading-bot/") || path === "crypto-scanner") {
    return new Response(JSON.stringify({ error: "This endpoint is handled by a dedicated function" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  let alpacaUrl;

  // Data API routes (crypto bars, quotes, trades)
  if (path.startsWith("crypto/") || path.startsWith("bars/") || path.startsWith("crypto/us/")) {
    alpacaUrl = `${ALPACA_DATA_BASE}/${path}`;
  } else {
    alpacaUrl = `${ALPACA_BASE}/${path}`;
  }

  // Forward query params
  const search = url.searchParams.toString();
  if (search) alpacaUrl += `?${search}`;

  const method = req.method || "GET";
  let body;
  if (method !== "GET" && method !== "HEAD") {
    body = await req.text();
  }

  try {
    const resp = await fetchWithRetry(alpacaUrl, { method, headers, body });

    // Alpaca may return 204 for DELETE (cancel order)
    if (resp.status === 204) {
      return new Response(JSON.stringify({ success: true }), {
        status: 204,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    return new Response(JSON.stringify(data), {
      status: resp.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};

// No path config - routed via netlify.toml redirects