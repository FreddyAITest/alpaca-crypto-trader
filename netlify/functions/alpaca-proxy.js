const ALPACA_API_KEY = process.env.ALPACA_API_KEY || "PKFJY5TRMF36BGN76LPRGRUKTO";
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY || "";
const ALPACA_BASE = "https://paper-api.alpaca.markets/v2";
const ALPACA_DATA_BASE = "https://data.alpaca.markets/v1beta3";

const headers = {
  "APCA-API-KEY-ID": ALPACA_API_KEY,
  "APCA-API-SECRET-KEY": ALPACA_SECRET_KEY,
  "Content-Type": "application/json",
};

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace("/api/", "");

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
    const resp = await fetch(alpacaUrl, { method, headers, body });

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
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = { path: "/api/*" };
