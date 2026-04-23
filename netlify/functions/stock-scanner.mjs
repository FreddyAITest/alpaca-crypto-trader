// Stock Scanner - Scans Alpaca for momentum stocks
// Identifies top gainers/losers for the trading bot to target
// These can hit 2-8% daily moves more frequently than crypto in some cases

import { getStockSnapshot, getStockBars, isMarketOpen } from "./lib/alpaca-client.mjs";

// Hot stock universe - high-volume, high-volatility tickers
const STOCK_UNIVERSE = [
  // Mega-cap tech
  "TSLA", "NVDA", "AMD", "AAPL", "MSFT", "GOOGL", "AMZN", "META",
  // ETFs for leveraged plays  
  "SPY", "QQQ", "SOXL", "TQQQ", "SQQQ", "TNA", "TZA",
  // Crypto-adjacent
  "MARA", "RIOT", "COIN", "MSTR", "HUT", "CLSK",
  // High-volatility growth
  "PLTR", "SOFI", "RIVN", "LCID", "NIO", "AFRM", "RBLX", "UPST",
  // Momentum plays
  "SMCI", "CRWD", "PANW", "SNOW", "DDOG", "NET", "MDB",
  // E-commerce/fintech
  "MELI", "SHOP", "SQ", "ROKU",
  // Recovery/value plays
  "F", "BAC", "C", "DIS", "INTC", "PFE",
  // Streaming/gaming
  "NFLX", "EA", "ATVI",
  // SaaS
  "CRM", "ADBE", "NOW",
];

export default async (req) => {
  try {
    const marketOpen = await isMarketOpen();
    
    if (!marketOpen) {
      return new Response(JSON.stringify({
        status: "market_closed",
        message: "Stock market is closed. No stock signals available.",
        stocks: [],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch snapshots for all stocks
    const snapshots = await getStockSnapshot(STOCK_UNIVERSE);
    
    // Process and find movers
    const movers = [];
    if (snapshots?.snapshots) {
      for (const [symbol, snap] of Object.entries(snapshots.snapshots)) {
        const prevClose = snap.prevDailyBar?.c || snap.prevDailyBar?.close;
        const latestPrice = snap.latestTrade?.p || snap.dailyBar?.c || snap.dailyBar?.close;
        const dailyVolume = snap.dailyBar?.v || 0;
        
        if (prevClose && latestPrice && prevClose > 5) { // Filter penny stocks
          const dailyChange = ((latestPrice - prevClose) / prevClose) * 100;
          
          // Only include significant movers (>2% for stocks)
          if (Math.abs(dailyChange) >= 2) {
            movers.push({
              symbol,
              price: latestPrice,
              prevClose,
              dailyChange: dailyChange.toFixed(2),
              volume: dailyVolume,
              direction: dailyChange > 0 ? "up" : "down",
            });
          }
        }
      }
    }
    
    // Sort by absolute daily change
    movers.sort((a, b) => Math.abs(parseFloat(b.dailyChange)) - Math.abs(parseFloat(a.dailyChange)));
    
    // Get detailed bars for top movers
    const topMovers = movers.slice(0, 15);
    if (topMovers.length > 0) {
      const symbols = topMovers.map(m => m.symbol);
      try {
        const barsData = await getStockBars(symbols, "1Hour", 50);
        // Attach bars to movers
        for (const mover of topMovers) {
          if (barsData?.bars?.[mover.symbol]) {
            mover.hasBars = true;
          }
        }
      } catch (e) {
        // Bars are nice-to-have for signal strength
      }
    }

    return new Response(JSON.stringify({
      status: "ok",
      marketOpen,
      totalScanned: STOCK_UNIVERSE.length,
      moversFound: movers.length,
      stocks: topMovers,
      allMovers: movers.slice(0, 50),
    }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      status: "error",
      error: err.message,
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};