// Trading Bot v5 - PERSISTENT STATE EDITION
// Key v5 improvements:
// 1. All bot state persisted via Netlify Blobs (survives cold starts)
// 2. Learning state (adaptive params, win/loss) persisted and rebuilt from Alpaca API on cold start
// 3. Daily trade counts survive redeployments
// 4. Position snapshots persisted for change detection
// 5. ATR-based stop-losses, multi-strategy scanning from v4 preserved
//
// Runs every 5 minutes via Netlify scheduled function
// Scans 60+ crypto pairs + stocks during market hours

import { getAccount, getPositions, getPortfolioHistory, getCryptoBars, getCryptoSnapshot, getActivities, getStockSnapshot, isMarketOpen, toDataSymbol, toTradeSymbol } from "./lib/alpaca-client.mjs";
import { RiskManager } from "./lib/risk-manager.mjs";
import { analyzeSymbol, scanSymbols, scanMovers, scanStockMovers, WATCH_LIST, STOCK_UNIVERSE, setLearningState, getLearningState } from "./lib/strategy.mjs";
import { executeBuy, liquidatePosition, executeSignal, executeStockSignal, closeWorstPositions, rotateStalePositions, rotateBottomPerformers, replaceStopsAndTargets, cancelSellOrders } from "./lib/executor.mjs";
import { recordRun } from "./lib/health-store.mjs";
import { loadBotState, saveBotState, loadLearningState, saveLearningState, rebuildLearningFromAPI, savePositionSnapshot } from "./lib/state-store.mjs";

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
    log("=== Trading Bot v5 (PERSISTENT STATE) Started ===");

    // ============================================================
    // PHASE 0: LOAD PERSISTENT STATE
    // Bot state (trade counts, peak equity, daily stats) is loaded
    // from Netlify Blobs, not lost on cold starts anymore.
    // Learning state is also loaded; if stale, rebuilt from API.
    // ============================================================
    let botState = await loadBotState();
    log(`[STATE] Loaded bot state: totalTrades=${botState.totalTrades}, dailyTrades=${botState.dailyTradeCount}, peakEquity=$${botState.peakEquity?.toFixed(2) || '0'}`);

    // Load persisted learning state (adaptive params)
    let learningState = await loadLearningState();
    log(`[STATE] Loaded learning state: winRate=${learningState.winRate?.toFixed(2) || '0.50'}, totalWins=${learningState.totalWins}, totalLosses=${learningState.totalLosses}`);

    // If learning state has no recent trades, try to rebuild from Alpaca API
    if (learningState.totalWins + learningState.totalLosses < 5) {
      log("[STATE] Learning state too thin, rebuilding from Alpaca activities API...");
      try {
        const rebuilt = await rebuildLearningFromAPI(getActivities, 7);
        if (rebuilt.totalWins + rebuilt.totalLosses > learningState.totalWins + learningState.totalLosses) {
          learningState = rebuilt;
          await saveLearningState(learningState);
          log(`[STATE] Rebuilt learning state from API: ${rebuilt.totalWins}W/${rebuilt.totalLosses}L, winRate=${rebuilt.winRate.toFixed(2)}`);
        }
      } catch (e) {
        log(`[STATE] Rebuild from API failed: ${e.message}`);
      }
    }

    // Inject learning state into strategy module for this run
    setLearningState(learningState);
    log(`[STATE] Injected learning state into strategy module`);

    // Reset daily trade counter at midnight
    const today = new Date().toISOString().slice(0, 10);
    if (botState.dailyResetDate !== today) {
      const prevDayTrades = botState.dailyTradeCount;
      botState.dailyTradeCount = 0;
      botState.dailyResetDate = today;
      log(`Daily trade counter reset for ${today} (was ${prevDayTrades})`);
    }

    // 1. Get account state
    const account = await getAccount();
    const equity = parseFloat(account.equity);
    const cash = parseFloat(account.cash);
    botState.peakEquity = Math.max(botState.peakEquity || 0, equity);
    log(`Account: equity=$${equity.toFixed(2)}, cash=$${cash.toFixed(2)}, status=${account.status}`);

    // 2. Get current positions
    const positions = await getPositions();
    log(`Open positions: ${positions.length}/25 slots, total exposure: $${positions.reduce((s, p) => s + parseFloat(p.market_value || 0), 0).toFixed(2)}`);

    // Save position snapshot for change detection
    await savePositionSnapshot(positions);

    // 3. Learn from recent trade outcomes — UPDATE persistent learning state
    try {
      const activities = await getActivities(new Date(Date.now() - 86400000).toISOString());
      if (Array.isArray(activities)) {
        let learnedCount = 0;
        for (const act of activities.slice(0, 100)) {
          if (act.side === "sell" && parseFloat(act.net_amount || 0) !== 0) {
            recordTradeOutcomePersistent(act.symbol || "unknown", "sell_close", parseFloat(act.net_amount || 0), learningState);
            learnedCount++;
          }
        }
        log(`Learning: processed ${activities.length} activities, learned from ${learnedCount} sells`);
        // Save updated learning state to persistent storage
        await saveLearningState(learningState);
      }
    } catch (e) {
      log(`Learning: could not fetch activities - ${e.message}`);
    }

    // 4. Risk manager - v6 config (more aggressive for higher trade volume)
    const riskManager = new RiskManager({
      maxPositionPct: 0.10,       // 10% per position for bigger trades
      dailyLossLimitPct: 0.05,    // 5% daily loss limit
      maxDrawdownPct: 0.10,       // 10% max drawdown (wider for crypto volatility)
      maxOpenPositions: 25,
      minTradeSizeUsd: 500,
      defaultStopLossPct: 0.04,   // 4% SL (v6: tighter from 5% for faster rotation)
      defaultTakeProfitPct: 0.06, // 6% TP (v6: tighter from 8% for faster profit-taking)
      useAtrStops: true,
    });

    // 5. Check if trading is allowed
    const portfolioHistory = await getPortfolioHistory("1M", "1D");
    const tradingAllowed = await riskManager.checkTradingAllowed(account, positions, portfolioHistory);
    log(`Risk check: ${tradingAllowed.allowed ? "ALLOWED" : "BLOCKED"} - ${tradingAllowed.reason}`);

    // 6. Check stop-loss / take-profit on existing positions
    // v6: Skip crypto positions that are mostly unsettled (qty_available ≈ 0)
    const slTpActions = riskManager.checkStopLossTakeProfit(positions)
      .filter(action => {
        // Find the position for this action
        const pos = positions.find(p => p.symbol === action.symbol);
        if (pos) {
          const qty = parseFloat(pos.qty);
          const qtyAvailable = parseFloat(pos.qty_available ?? qty);
          const isCrypto = pos.asset_class === "crypto" || pos.symbol.includes("USD") || pos.symbol.includes("/");
          if (isCrypto && qty > 0 && qtyAvailable / qty < 0.10) {
            log(`STOP-LOSS/TAKE-PROFIT: SKIPPED ${action.symbol} - only ${(qtyAvailable / qty * 100).toFixed(1)}% settled`);
            return false;
          }
        }
        return true;
      });
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

    // 6b. Close underperformers — v5: more aggressive threshold (0.3% loss) for faster capital turnover
    if (positions.length > 3) {
      log("Closing underperformers (threshold: -0.3%)...");
      const closed = await closeWorstPositions(positions, 0.003);
      for (const c of closed) {
        actions.push({ type: "close", symbol: c.symbol, reason: `Underperformer: ${(c.pnl * 100).toFixed(1)}%`, result: c.result });
        botState.dailyTradeCount++;
      }
      if (closed.length > 0) log(`Closed ${closed.length} underperformers`);
    }

    // 6c. Rotate stale/tiny positions to free up slots and capital
    // v5: more aggressive — rotate positions older than 2h with pnl between -0.3% and +0.3%
    if (positions.length >= 5) {
      log("Rotating stale positions...");
      const rotated = await rotateStalePositions(positions, equity);
      for (const r of rotated) {
        actions.push({ type: "rotate", symbol: r.symbol, reason: r.reason, result: r.result });
        botState.dailyTradeCount++;
      }
      if (rotated.length > 0) log(`Rotated ${rotated.length} stale positions`);
    }

    // 6d. Rotate bottom 3 performers every cycle for maximum learning velocity
    if (positions.length >= 4) {
      log("Rotating bottom performers for velocity...");
      const bottomRotated = await rotateBottomPerformers(positions, 3);
      for (const r of bottomRotated) {
        actions.push({ type: "rotate_bottom", symbol: r.symbol, reason: r.reason, result: r.result });
        botState.dailyTradeCount++;
      }
      if (bottomRotated.length > 0) log(`Rotated ${bottomRotated.length} bottom performers`);
    }

    // 6e. Re-place missing SL/TP orders for all open positions (v6: 4% SL, 6% TP)
    try {
      const sltpResults = await replaceStopsAndTargets(positions, 0.04, 0.06);
      for (const r of sltpResults) {
        if (r.action && r.action !== "skip") {
          actions.push({ type: "sltp_replace", symbol: r.symbol, action: r.action, price: r.price });
          log(`SL/TP Replace: ${r.symbol} - ${r.action}${r.price ? ` @ $${r.price}` : ''}${r.reason ? ` (${r.reason})` : ''}`);
        }
      }
    } catch (e) {
      log(`SL/TP replace failed: ${e.message}`);
    }

    // Refresh positions after closes
    let currentPositions = positions;
    if (slTpActions.length > 0 || actions.some(a => a.type === "close" || a.type === "rotate" || a.type === "rotate_bottom")) {
      try {
        currentPositions = await getPositions();
        log(`Positions after closes: ${currentPositions.length}`);
      } catch (e) {
        log(`Could not refresh positions: ${e.message}`);
        currentPositions = positions;
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
          
          try {
            const barsResp = await getCryptoBars(dataSymbol, "1Hour", 100);
            if (barsResp.bars) {
              const barsKey = Object.keys(barsResp.bars).find(k => k === dataSymbol || k === symbol || k === toTradeSymbol(symbol));
              if (barsKey && barsResp.bars[barsKey]) {
                barsBySymbol[symbol] = barsResp.bars[barsKey];
              }
            }
          } catch (e) { /* skip */ }
          
          try {
            const bars15MResp = await getCryptoBars(dataSymbol, "15Min", 100);
            if (bars15MResp.bars) {
              const barsKey = Object.keys(bars15MResp.bars).find(k => k === dataSymbol || k === symbol || k === toTradeSymbol(symbol));
              if (barsKey && bars15MResp.bars[barsKey]) {
                bars15MBySymbol[symbol] = bars15MResp.bars[barsKey];
              }
            }
          } catch (e) { /* optional */ }

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

      // Fallback: extract prices from bar data
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
      
      // Execute signals
      for (const signal of signals) {
        log(`  [CRYPTO] ${signal.symbol}: ${signal.signal.toUpperCase()} str=${(signal.strength * 100).toFixed(0)}% [${signal.strategy}${signal.confirmed ? " confirmed" : ""}] - ${signal.reasons.slice(0, 3).join(", ")}`);
        
        const tradeSym = toTradeSymbol(signal.symbol);
        const dataSym = toDataSymbol(signal.symbol);
        signal.currentPrice = priceMap[signal.symbol] || priceMap[dataSym] || priceMap[tradeSym] || 0;
        
        if (signal.currentPrice > 0 && currentPositions.length + newTrades.length < 25) {
          signal.symbol = tradeSym;
          const result = await executeSignal(signal, riskManager, equity, currentPositions);
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
          
          for (const mover of stockMovers.slice(0, 5)) {
            if (mover.direction === "up" && currentPositions.length + newTrades.length < 25) {
              log(`  [STOCKS] ${mover.symbol}: UP ${mover.dailyChange.toFixed(1)}% at $${mover.price.toFixed(2)}`);
              try {
                const result = await executeStockSignal(
                  { symbol: mover.symbol, signal: "buy", price: mover.price, strategy: "stock-momentum" },
                  riskManager, equity, currentPositions
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
    const riskSummary = riskManager.getRiskSummary(account, currentPositions);
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

    // ============================================================
    // PERSIST STATE: Save bot state and learning state to Blobs
    // This is the critical v5 addition — state survives cold starts
    // ============================================================
    await saveBotState(botState);
    await saveLearningState(learningState);
    log("[STATE] Persisted bot state and learning state to Netlify Blobs");

    const response = {
      status: "ok",
      version: "5.0-persistent-state",
      runAt: runStart,
      risk: riskSummary,
      tradingAllowed: tradingAllowed.allowed,
      riskReason: tradingAllowed.reason,
      positions: currentPositions.length,
      cryptoSignals: signalsFound,
      stockSignals: stockSignalsFound,
      dailyTrades: botState.dailyTradeCount,
      actions: actions.map(a => ({
        type: a.type,
        symbol: a.type === "close" || a.type === "rotate" || a.type === "rotate_bottom" ? a.symbol : a.signal?.symbol,
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
        persisted: true,
      },
      logs: logs.slice(-40),
      botState: {
        lastRun: botState.lastRun,
        totalTrades: botState.totalTrades,
        totalRuns: botState.runHistory.length,
        peakEquity: botState.peakEquity,
        dailyTrades: botState.dailyTradeCount,
        dailyResetDate: botState.dailyResetDate,
        statePersisted: true,
      },
    };

    log(`=== Trading Bot v5 Completed: ${botState.dailyTradeCount} daily trades, ${signalsFound} crypto signals, ${stockSignalsFound} stock signals ===`);

    // Persist health data for monitoring dashboard
    const runDurationMs = Date.now() - runStartMs;
    await recordRun({ success: true, durationMs: runDurationMs });

    return new Response(JSON.stringify(response, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    log(`FATAL ERROR: ${err.message}`);

    // Try to persist state even on error (best effort)
    try {
      await saveBotState(botState || { lastRun: runStart, totalTrades: 0, runHistory: [], peakEquity: 0, dailyTradeCount: 0, dailyResetDate: null });
    } catch (e) { /* best effort */ }

    // Persist error health data for monitoring
    const runDurationMs = Date.now() - runStartMs;
    await recordRun({ success: false, error: err.message, durationMs: runDurationMs }).catch(() => {});

    return new Response(JSON.stringify({
      status: "error",
      version: "5.0-persistent-state",
      error: err.message,
      stack: err.stack,
      logs,
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

// ============================================================
// Learning State Bridge
// strategy.mjs uses module-level learningState. In v5:
// - We load learning state from Netlify Blobs at startup
// - We inject it into the strategy module via setLearningState()
// - During the run, recordTradeOutcome() in strategy.mjs updates the module-level state
// - We capture the final state via getLearningState() and save back to Blobs
// - Our persistent recordTradeOutcomePersistent() is used for the API-sourced learning
//   data (step 3), which also adapts params independently
// ============================================================

/**
 * Record a trade outcome in our persistent learning state.
 * This is the persistent companion to strategy.mjs's recordTradeOutcome.
 */
function recordTradeOutcomePersistent(symbol, signalType, pnl, learningState) {
  learningState.tradeHistory.push({
    symbol,
    signal: signalType,
    pnl,
    timestamp: Date.now(),
  });
  learningState.tradeHistory = learningState.tradeHistory.slice(-500);
  if (pnl > 0) learningState.totalWins++;
  else learningState.totalLosses++;
  learningState.winRate = learningState.totalWins / (learningState.totalWins + learningState.totalLosses);
  
  // Adapt parameters based on recent performance
  const recent = learningState.tradeHistory.slice(-50);
  if (recent.length >= 10) {
    const recentWins = recent.filter(t => t.pnl > 0).length;
    const recentWinRate = recentWins / recent.length;
    
    if (recentWinRate > 0.6) {
      learningState.adaptiveParams.signalThreshold = Math.max(0.12, learningState.adaptiveParams.signalThreshold - 0.015);
      learningState.adaptiveParams.scalpThreshold = Math.max(0.08, learningState.adaptiveParams.scalpThreshold - 0.01);
      learningState.adaptiveParams.rsiOversold = Math.min(42, learningState.adaptiveParams.rsiOversold + 1);
      learningState.adaptiveParams.rsiOverbought = Math.max(58, learningState.adaptiveParams.rsiOverbought - 1);
    } else if (recentWinRate < 0.4) {
      learningState.adaptiveParams.signalThreshold = Math.min(0.4, learningState.adaptiveParams.signalThreshold + 0.02);
      learningState.adaptiveParams.scalpThreshold = Math.min(0.25, learningState.adaptiveParams.scalpThreshold + 0.015);
      learningState.adaptiveParams.rsiOversold = Math.max(25, learningState.adaptiveParams.rsiOversold - 1);
      learningState.adaptiveParams.rsiOverbought = Math.min(75, learningState.adaptiveParams.rsiOverbought + 1);
    }
    
    learningState.lastAdaptation = new Date().toISOString();
  }
}