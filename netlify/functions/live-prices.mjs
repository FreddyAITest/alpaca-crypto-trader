// Live Prices API - Lightweight endpoint for frequent polling
// Returns just snapshot data for the ticker symbols - no auth needed for read
// Designed to be polled every 5 seconds with minimal overhead
// Also supports SSE stream (?stream=true) for push-based updates

import { getCryptoSnapshot, toDataSymbol } from "./lib/alpaca-client.mjs";

const TICKER_SYMBOLS = [
  "BTC/USD", "ETH/USD", "SOL/USD", "DOGE/USD",
  "ADA/USD", "AVAX/USD", "LINK/USD", "MATIC/USD",
];

// Cache responses for 3 seconds to avoid API spam
let cachedPrices = null;
let cacheTime = 0;
const CACHE_TTL = 3000; // 3 seconds

export default async (req) => {
  const url = new URL(req.url);
  
  // SSE stream mode
  if (url.searchParams.get("stream") === "true") {
    // For serverless, we send a single snapshot with stream headers
    // Client reconnects every 3-5 seconds for near-real-time updates
    const prices = await fetchPrices();
    const sseData = `event: prices\ndata: ${JSON.stringify({ timestamp: Date.now(), prices })}\n\nevent: connected\ndata: ${JSON.stringify({ timestamp: Date.now(), mode: "poll-reconnect" })}\n\n`;
    
    return new Response(sseData, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Regular polling endpoint
  try {
    const now = Date.now();
    
    // Return cached data if fresh enough
    if (cachedPrices && (now - cacheTime) < CACHE_TTL) {
      return new Response(JSON.stringify(cachedPrices), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3",
          "X-Cache": "HIT",
        },
      });
    }

    const prices = await fetchPrices();
    const response = {
      timestamp: new Date().toISOString(),
      prices,
    };

    // Cache the result
    cachedPrices = response;
    cacheTime = now;

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3",
        "X-Cache": "MISS",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      status: "error",
      error: err.message,
      timestamp: new Date().toISOString(),
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

async function fetchPrices() {
  const dataSymbols = TICKER_SYMBOLS.map(s => toDataSymbol(s));
  const snapshotData = await getCryptoSnapshot(dataSymbols);
  
  const prices = {};
  if (snapshotData?.snapshots) {
    for (const [key, snap] of Object.entries(snapshotData.snapshots)) {
      const price = parseFloat(snap.latestTrade?.p || snap.dailyBar?.c || 0);
      const prevClose = parseFloat(snap.prevDailyBar?.c || 0);
      const dailyBar = snap.dailyBar;
      if (price > 0) {
        // Normalize key to symbol format (BTC/USD, ETH/USD, etc.)
        const symbol = key.includes("/") ? key : key.replace(/(\w+)(USD|USDT)/, "$1/$2");
        prices[symbol] = {
          price,
          prevClose,
          dailyChange: prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0,
          dailyHigh: parseFloat(dailyBar?.h || 0),
          dailyLow: parseFloat(dailyBar?.l || 0),
          dailyVolume: parseFloat(dailyBar?.v || 0),
          lastTradeTime: snap.latestTrade?.t || null,
          bid: parseFloat(snap.latestQuote?.bp || 0),
          ask: parseFloat(snap.latestQuote?.ap || 0),
          spread: parseFloat(snap.latestQuote?.ap || 0) - parseFloat(snap.latestQuote?.bp || 0),
        };
      }
    }
  }
  return prices;
}