// Backtest API - DEF-13
// Runs walk-forward backtests on crypto symbols and compares before/after
// learning parameters. Exposes metrics via JSON API.
//
// Query params:
//   symbol      - Single symbol to test (e.g. BTC/USD, ETH/USD)
//   symbols     - Comma-separated list of symbols
//   compare     - Run comparison mode (before vs after learning params)
//   days        - Number of days of historical data (default 30)
//   action      - "run" (default), "compare", or "list" (available params)

import { getCryptoBars, toDataSymbol } from "./lib/alpaca-client.mjs";
import { runBacktest, compareParams, runMultiBacktest } from "./lib/backtester.mjs";
import { WATCH_LIST, DEFAULT_PARAMS } from "./lib/strategy.mjs";
import { loadLearningState } from "./lib/state-store.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "run";
  const symbolParam = url.searchParams.get("symbol") || url.searchParams.get("symbols") || "BTC/USD";
  const days = parseInt(url.searchParams.get("days") || "30");
  const compareMode = url.searchParams.get("compare") === "true";

  try {
    // Load current learning params for comparison
    let learningState;
    try {
      learningState = await loadLearningState();
    } catch (e) {
      learningState = null;
    }
    const learnedParams = learningState?.adaptiveParams || DEFAULT_PARAMS;

    if (action === "list") {
      return jsonResponse({
        availableParams: {
          default: DEFAULT_PARAMS,
          learned: learnedParams,
        },
        watchList: WATCH_LIST,
        actions: ["run", "compare", "list"],
      });
    }

    // Parse symbols
    const symbols = symbolParam.split(",").map(s => s.trim()).filter(Boolean);

    // Fetch historical bars for each symbol
    const barsBySymbol = {};
    const fetchErrors = [];

    for (const symbol of symbols.slice(0, 10)) { // Max 10 symbols per request
      try {
        const dataSymbol = toDataSymbol(symbol);
        const barsResp = await getCryptoBars(dataSymbol, "1Hour", Math.min(days * 24, 720));
        if (barsResp?.bars) {
          const barsKey = Object.keys(barsResp.bars).find(
            k => k === dataSymbol || k === symbol
          );
          if (barsKey && barsResp.bars[barsKey]?.length >= 50) {
            barsBySymbol[symbol] = barsResp.bars[barsKey];
          } else {
            fetchErrors.push(`${symbol}: insufficient bars`);
          }
        } else {
          fetchErrors.push(`${symbol}: no bar data`);
        }
      } catch (e) {
        fetchErrors.push(`${symbol}: ${e.message}`);
      }
    }

    if (Object.keys(barsBySymbol).length === 0) {
      return jsonResponse({ error: "No bar data available", fetchErrors }, 400);
    }

    if (compareMode || action === "compare") {
      // Comparison mode: test default params vs learned params on each symbol
      const comparisons = {};
      for (const [symbol, bars] of Object.entries(barsBySymbol)) {
        comparisons[symbol] = compareParams(bars, DEFAULT_PARAMS, learnedParams);
      }
      return jsonResponse({
        mode: "compare",
        symbols: Object.keys(barsBySymbol),
        days,
        comparisons,
        fetchErrors,
      });
    }

    // Default: run backtest with learned params
    if (symbols.length === 1) {
      const symbol = symbols[0];
      const bars = barsBySymbol[symbol];
      const result = runBacktest(bars, learnedParams);
      return jsonResponse({
        mode: "single",
        symbol,
        days,
        ...result,
        fetchErrors,
      });
    }

    // Multi-symbol backtest
    const result = runMultiBacktest(barsBySymbol, learnedParams);
    return jsonResponse({
      mode: "multi",
      symbols: Object.keys(barsBySymbol),
      days,
      ...result,
      fetchErrors,
    });

  } catch (err) {
    return jsonResponse({ error: err.message, stack: err.stack }, 500);
  }
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
