// Trading Bot v3 - HIGH-VOLUME LEARNING BOT
// Runs every 5 minutes, scans 60+ crypto pairs + stocks during market hours
// Multi-strategy: momentum + scalping + mean-reversion
// Multi-timeframe: 1H + 15M + 5M analysis
// $500+ per trade, 25 max positions, adaptive parameters from trade outcomes
// Position rotation for high trade throughput
// Targets 2-8% daily returns with aggressive learning signals

import { getAccount, getPositions, getPortfolioHistory, getCryptoBars, getCryptoSnapshot, getActivities, getStockSnapshot, isMarketOpen, toDataSymbol, toTradeSymbol } from "./lib/alpaca-client.js";
import { RiskManager } from "./lib/risk-manager.js";
import { analyzeSymbol, scanSymbols, scanMovers, scanStockMovers, WATCH_LIST, STOCK_UNIVERSE, recordTradeOutcome, getLearningState } from "./lib/strategy.js";
import { executeBuy, liquidatePosition, executeSignal, executeStockSignal, closeWorstPositions, rotateStalePositions } from "./lib/executor.js";
import { recordRun } from "./lib/health-store.js";

// Bot state stored in memory (resets on cold start)
let botState = {
  lastRun: null,
  totalTrades: 0,
  totalPnl: 0,
  runHistory: [],
  peakEquity: 0,
  dailyTradeCount: 0,
  dailyResetDate: null,
};

export default async (req) => {
  const runStart = new Date().toISOString();
  const runStartMs = Date.now();
  const logs = [];
  const actions = [];
  let signalsFound = 0;
  let stockSignalsFound = 0;

  const log = (msg) => {
    logs.push(`[${new Date().toISOString()}] ${msg}`);
    console.log(msg);
  };

  try {
    log("=== Trading Bot v3 (HIGH-VOLUME LEARNING) Started ===");

    // Reset daily trade counter at midnight
    const today = new Date().toISOString().slice(0, 10);
    if (botState.dailyResetDate !== today) {
      botState.dailyTradeCount = 0;
      botState.dailyResetDate = today;
      log(`Daily trade counter reset for ${today}`);
    }

    // 1. Get account state
    const account = await getAccount();
    const equity = parseFloat(account.equity);
    const cash = parseFloat(account.cash);
    botState.peakEquity = Math.max(botState.peakEquity, equity);
    log(`Account: equity=$${equity.toFixed(2)}, cash=$${cash.toFixed(2)}, status=${account.status}`);

    // 2. Get current positions
    const positions = await getPositions();
    log(`Open positions: ${positions.length}/${25} slots`);

    // 3. Learn from recent trade outcomes
    try {
      const activities = await getActivities(new Date(Date.now() - 86400000).toISOString());
      if (Array.isArray(activities)) {
        let learnedCount = 0;
        for (const act of activities.slice(0, 100)) {
          if (act.side === "sell" && parseFloat(act.net_amount || 0) !== 0) {
            recordTradeOutcome(act.symbol || "unknown", "sell_close", parseFloat(act.net_amount || 0));
            learnedCount++;
          }
        }
        log(`Learning: processed ${activities.length} activities, learned from ${learnedCount} sells`);
      }
    } catch (e) {
      log(`Learning: could not fetch activities - ${e.message}`);
    }

    // 4. Risk manager - v3 config for high volume
    const riskManager = new RiskManager({
      maxPositionPct: 0.03,       // 3% per position (more diversification)
      dailyLossLimitPct: 0.03,
      maxDrawdownPct: 0.05,
      maxOpenPositions: 25,       // Up from 15
      minTradeSizeUsd: 500,
      defaultStopLossPct: 0.03,
      defaultTakeProfitPct: 0.06,
      useAtrStops: true,
    });

    // 5. Check if trading is allowed
    const portfolioHistory = await getPortfolioHistory("1M", "1D");
    const tradingAllowed = await riskManager.checkTradingAllowed(account, positions, portfolioHistory);
    log(`Risk check: ${tradingAllowed.allowed ? "ALLOWED" : "BLOCKED"} - ${tradingAllowed.reason}`);

    // 6. Check stop-loss / take-profit on existing positions
    const slTpActions = riskManager.checkStopLossTakeProfit(positions);
    for (const action of slTpActions) {
      log(`STOP-LOSS/TAKE-PROFIT: ${action.symbol} - ${action.reason}`);
      try {
        const result = await liquidatePosition(action.symbol);
        actions.push({ type: "close", symbol: action.symbol, reason: action.reason, result });
        botState.dailyTradeCount++;
        log(`  Result: ${result.message}`);
      } catch (e) {
        log(`  Close failed: ${e.message}`);
      }
    }

    // 6b. Close underperformers if portfolio is crowded
    if (positions.length > 15) {
      log("Portfolio has 15+ positions, closing underperformers...");
      const closed = await closeWorstPositions(positions, 0.02);
      for (const c of closed) {
        actions.push({ type: "close", symbol: c.symbol, reason: `Underperformer: ${(c.pnl * 100).toFixed(1)}%`, result: c.result });
        botState.dailyTradeCount++;
      }
    }

    // 6c. Rotate stale/tiny positions to free up slots for new signals
    if (positions.length >= 20) {
      log("Near position limit, rotating stale positions...");
      const rotated = await rotateStalePositions(positions);
      for (const r of rotated) {
        actions.push({ type: "rotate", symbol: r.symbol, reason: r.reason, result: r.result });
        botState.dailyTradeCount++;
      }
    }

    // 7. CRYPTO SCANNING - primary trading engine
    let newTrades = [];
    if (tradingAllowed.allowed) {
      // --- CRYPTO SIGNALS ---
      log(`[CRYPTO] Scanning ${WATCH_LIST.length} watch list symbols...`);
      
      // Build price map from snapshots (batched to avoid API errors from bad symbols)
      const priceMap = {};
      let snapshotData;
      try {
        // Batch snapshot requests into groups of 20 to isolate bad symbols
        const dataSymbols = WATCH_LIST.map(s => toDataSymbol(s));
        let snaps = {};
        for (let i = 0; i < dataSymbols.length; i += 20) {
          const batch = dataSymbols.slice(i, i + 20);
          try {
            const batchResp = await getCryptoSnapshot(batch);
            if (batchResp?.snapshots) {
              Object.assign(snaps, batchResp.snapshots);
            }
          } catch (batchErr) {
            log(`[CRYPTO] Snapshot batch ${i}-${i + batch.length} failed: ${batchErr.message}`);
            // Try individual symbols from this batch
            for (const sym of batch) {
              try {
                const singleResp = await getCryptoSnapshot([sym]);
                if (singleResp?.snapshots) {
                  Object.assign(snaps, singleResp.snapshots);
                }
              } catch (e) { /* skip bad symbol */ }
            }
          }
        }
        snapshotData = { snapshots: snaps };
        if (Object.keys(snaps).length > 0) {
          for (const [key, snap] of Object.entries(snaps)) {
            const price = parseFloat(snap.latestTrade?.p || snap.dailyBar?.c || 0);
            if (price > 0) {
              priceMap[key] = price;
              priceMap[key.replace("/", "")] = price;
            }
          }
          log(`[CRYPTO] Got prices for ${Object.keys(priceMap).length / 2} symbols via snapshots`);
          
          // Report top movers
          const movers = scanMovers(snaps);
          if (movers.length > 0) {
            log(`[CRYPTO] Top movers: ${movers.length}`);
            for (const m of movers.slice(0, 15)) {
              log(`  ${m.symbol}: ${m.direction} ${m.dailyChange.toFixed(1)}% ($${m.price.toFixed(2)})`);
            }
          }
        }
      } catch (e) {
        log(`[CRYPTO] Snapshot fetch entirely failed: ${e.message}`);
      }
      
      // Fetch bars for each symbol - 1H, 15M, and 5M timeframes
      const barsBySymbol = {};
      const bars15MBySymbol = {};
      const bars5MBySymbol = {};
      const fetchStart = Date.now();
      let fetched = 0;
      
      for (const symbol of WATCH_LIST) {
        try {
          const dataSymbol = toDataSymbol(symbol);
          
          // 1-hour bars (primary)
          try {
            const barsResp = await getCryptoBars(dataSymbol, "1Hour", 100);
            if (barsResp.bars) {
              const barsKey = Object.keys(barsResp.bars).find(k => k === dataSymbol || k === symbol || k === toTradeSymbol(symbol));
              if (barsKey && barsResp.bars[barsKey]) {
                barsBySymbol[symbol] = barsResp.bars[barsKey];
              }
            }
          } catch (e) { /* skip */ }
          
          // 15-minute bars (fast timeframe)
          try {
            const bars15MResp = await getCryptoBars(dataSymbol, "15Min", 100);
            if (bars15MResp.bars) {
              const barsKey = Object.keys(bars15MResp.bars).find(k => k === dataSymbol || k === symbol || k === toTradeSymbol(symbol));
              if (barsKey && bars15MResp.bars[barsKey]) {
                bars15MBySymbol[symbol] = bars15MResp.bars[barsKey];
              }
            }
          } catch (e) { /* optional */ }
          
          // 5-minute bars (scalp timeframe) - only for top movers to save API calls
          if (snapshotData?.snapshots) {
            const symData = snapshotData.snapshots[toDataSymbol(symbol)];
            if (symData) {
              const prevClose = symData.prevDailyBar?.c;
              const latest = symData.latestTrade?.p || symData.dailyBar?.c;
              if (prevClose && latest && Math.abs((latest - prevClose) / prevClose) > 0.02) {
                try {
                  const bars5MResp = await getCryptoBars(dataSymbol, "5Min", 100);
                  if (bars5MResp.bars) {
                    const barsKey = Object.keys(bars5MResp.bars).find(k => k === dataSymbol || k === symbol || k === toTradeSymbol(symbol));
                    if (barsKey && bars5MResp.bars[barsKey]) {
                      bars5MBySymbol[symbol] = bars5MResp.bars[barsKey];
                    }
                  }
                } catch (e) { /* optional */ }
              }
            }
          }
          
          fetched++;
        } catch (e) {
          log(`  [CRYPTO] Failed bars for ${symbol}: ${e.message}`);
        }
      }
      log(`[CRYPTO] Bar fetch: ${fetched}/${WATCH_LIST.length} symbols, 1H=${Object.keys(barsBySymbol).length}, 15M=${Object.keys(bars15MBySymbol).length}, 5M=${Object.keys(bars5MBySymbol).length} in ${((Date.now() - fetchStart)/1000).toFixed(1)}s`);

      // Fallback: extract prices from bar data for symbols missing in priceMap
      let pricesFromBars = 0;
      for (const symbol of WATCH_LIST) {
        const tradeSym = toTradeSymbol(symbol);
        const dataSym = toDataSymbol(symbol);
        if (!priceMap[symbol] && !priceMap[dataSym] && !priceMap[tradeSym]) {
          const bars = barsBySymbol[symbol];
          if (bars && bars.length > 0) {
            const closePrice = parseFloat(bars[bars.length - 1].c);
            if (closePrice > 0) {
              priceMap[symbol] = closePrice;
              priceMap[dataSym] = closePrice;
              priceMap[tradeSym] = closePrice;
              pricesFromBars++;
            }
          }
        }
      }
      if (pricesFromBars > 0) {
        log(`[CRYPTO] Got ${pricesFromBars} additional prices from bar data`);
      }

      // Scan for signals using multi-strategy, multi-timeframe analysis
      const signals = scanSymbols(barsBySymbol, bars15MBySymbol, bars5MBySymbol);
      signalsFound = signals.length;
      log(`[CRYPTO] Signals found: ${signalsFound}`);
      
      // Execute signals - go through ALL signals (not just top 3)
      for (const signal of signals) {
        log(`  [CRYPTO] ${signal.symbol}: ${signal.signal.toUpperCase()} str=${(signal.strength * 100).toFixed(0)}% [${signal.strategy}${signal.confirmed ? " confirmed" : ""}] - ${signal.reasons.slice(0, 3).join(", ")}`);
        
        const tradeSym = toTradeSymbol(signal.symbol);
        const dataSym = toDataSymbol(signal.symbol);
        signal.currentPrice = priceMap[signal.symbol] || priceMap[dataSym] || priceMap[tradeSym] || 0;
        
        if (signal.currentPrice > 0 && positions.length + newTrades.length < 25) {
          signal.symbol = tradeSym;
          const result = await executeSignal(signal, riskManager, equity, positions);
          actions.push({ type: "trade", signal, result });
          log(`  [CRYPTO] Executed: ${result.message}`);
          if (result.success) {
            newTrades.push(signal);
            botState.totalTrades++;
            botState.dailyTradeCount++;
          }
        }
      }

      // --- STOCK SIGNALS (during market hours) ---
      try {
        const marketOpen = await isMarketOpen();
        if (marketOpen) {
          log(`[STOCKS] Market is open, scanning ${STOCK_UNIVERSE.length} stocks...`);
          const stockSnaps = await getStockSnapshot(STOCK_UNIVERSE);
          const stockMovers = scanStockMovers(stockSnaps?.snapshots || {});
          stockSignalsFound = stockMovers.length;
          log(`[STOCKS] Movers found: ${stockSignalsFound}`);
          
          // Execute on top stock movers (long direction only)
          for (const mover of stockMovers.slice(0, 5)) {
            if (mover.direction === "up" && positions.length + newTrades.length < 25) {
              log(`  [STOCKS] ${mover.symbol}: UP ${mover.dailyChange.toFixed(1)}% at $${mover.price.toFixed(2)}`);
              try {
                const result = await executeStockSignal(
                  { symbol: mover.symbol, signal: "buy", price: mover.price, strategy: "stock-momentum" },
                  riskManager, equity, positions
                );
                actions.push({ type: "stock-trade", signal: { symbol: mover.symbol, strategy: "stock-momentum" }, result });
                if (result.success) {
                  newTrades.push({ symbol: mover.symbol, strategy: "stock-momentum" });
                  botState.totalTrades++;
                  botState.dailyTradeCount++;
                }
                log(`  [STOCKS] ${result.message}`);
              } catch (e) {
                log(`  [STOCKS] Failed ${mover.symbol}: ${e.message}`);
              }
            }
          }
        } else {
          log("[STOCKS] Market closed, skipping stock scan");
        }
      } catch (e) {
        log(`[STOCKS] Stock scan failed: ${e.message}`);
      }
    }

    // 8. Build risk summary and learning state
    const riskSummary = riskManager.getRiskSummary(account, positions);
    const learningInfo = getLearningState();

    botState.lastRun = runStart;
    botState.runHistory.push({
      time: runStart,
      equity,
      tradingAllowed: tradingAllowed.allowed,
      cryptoSignals: signalsFound,
      stockSignals: stockSignalsFound,
      tradesExecuted: newTrades.length,
      slTpCloses: slTpActions.length,
      dailyTrades: botState.dailyTradeCount,
    });
    botState.runHistory = botState.runHistory.slice(-100);

    const response = {
      status: "ok",
      version: "3.0-high-volume",
      runAt: runStart,
      risk: riskSummary,
      tradingAllowed: tradingAllowed.allowed,
      riskReason: tradingAllowed.reason,
      positions: positions.length,
      cryptoSignals: signalsFound,
      stockSignals: stockSignalsFound,
      dailyTrades: botState.dailyTradeCount,
      actions: actions.map(a => ({
        type: a.type,
        symbol: a.type === "close" || a.type === "rotate" ? a.symbol : a.signal?.symbol,
        strategy: a.signal?.strategy,
        reason: a.reason || a.signal?.reasons?.join("; "),
        success: a.result?.success,
        message: a.result?.message,
      })),
      learning: {
        winRate: learningInfo.winRate.toFixed(2),
        totalWins: learningInfo.totalWins,
        totalLosses: learningInfo.totalLosses,
        adaptiveParams: learningInfo.adaptiveParams,
        lastAdaptation: learningInfo.lastAdaptation,
        recentTrades: learningInfo.tradeHistory.length,
      },
      logs: logs.slice(-40),
      botState: {
        lastRun: botState.lastRun,
        totalTrades: botState.totalTrades,
        totalRuns: botState.runHistory.length,
        peakEquity: botState.peakEquity,
        dailyTrades: botState.dailyTradeCount,
      },
    };

    log(`=== Trading Bot v3 Completed: ${botState.dailyTradeCount} daily trades, ${signalsFound} crypto signals, ${stockSignalsFound} stock signals ===`);

    // Persist health data for monitoring dashboard
    const runDurationMs = Date.now() - runStartMs;
    await recordRun({ success: true, durationMs: runDurationMs });

    return new Response(JSON.stringify(response, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    log(`FATAL ERROR: ${err.message}`);

    // Persist error health data for monitoring
    const runDurationMs = Date.now() - runStartMs;
    await recordRun({ success: false, error: err.message, durationMs: runDurationMs }).catch(() => {});

    return new Response(JSON.stringify({
      status: "error",
      version: "3.0-high-volume",
      error: err.message,
      stack: err.stack,
      logs,
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};