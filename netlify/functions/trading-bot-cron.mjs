// Trading Bot Cron v4 - HIGH-VOLUME LEARNING BOT
// Scheduled by Netlify every 5 minutes
// Matches trading-bot.js v4 logic exactly
import { getAccount, getPositions, getPortfolioHistory, getCryptoBars, getCryptoSnapshot, getActivities, getStockSnapshot, isMarketOpen, toDataSymbol, toTradeSymbol } from "./lib/alpaca-client.mjs";
import { RiskManager } from "./lib/risk-manager.mjs";
import { analyzeSymbol, scanSymbols, scanMovers, scanStockMovers, WATCH_LIST, STOCK_UNIVERSE, recordTradeOutcome, getLearningState } from "./lib/strategy.mjs";
import { executeBuy, liquidatePosition, executeSignal, executeStockSignal, closeWorstPositions, rotateStalePositions, rotateBottomPerformers, replaceStopsAndTargets, cancelSellOrders } from "./lib/executor.mjs";
import { recordRun } from "./lib/health-store.mjs";

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
    log("=== Trading Bot v4 Cron (HIGH-VOLUME LEARNING) Started ===");

    const today = new Date().toISOString().slice(0, 10);
    if (botState.dailyResetDate !== today) {
      botState.dailyTradeCount = 0;
      botState.dailyResetDate = today;
      log(`Daily trade counter reset for ${today}`);
    }

    const account = await getAccount();
    const equity = parseFloat(account.equity);
    const cash = parseFloat(account.cash);
    botState.peakEquity = Math.max(botState.peakEquity, equity);
    log(`Account: equity=$${equity.toFixed(2)}, cash=$${cash.toFixed(2)}, status=${account.status}`);

    const positions = await getPositions();
    log(`Open positions: ${positions.length}/25, total exposure: $${positions.reduce((s, p) => s + parseFloat(p.market_value || 0), 0).toFixed(2)}`);

    // Learn from recent trades
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
      log(`Learning: activities failed - ${e.message}`);
    }

    const riskManager = new RiskManager({
      maxPositionPct: 0.05,
      dailyLossLimitPct: 0.03,
      maxDrawdownPct: 0.05,
      maxOpenPositions: 25,
      minTradeSizeUsd: 500,
      defaultStopLossPct: 0.03,
      defaultTakeProfitPct: 0.06,
      useAtrStops: true,
    });

    const portfolioHistory = await getPortfolioHistory("1M", "1D");
    const tradingAllowed = await riskManager.checkTradingAllowed(account, positions, portfolioHistory);
    log(`Risk check: ${tradingAllowed.allowed ? "ALLOWED" : "BLOCKED"} - ${tradingAllowed.reason}`);

    // SL/TP threshold closes
    const slTpActions = riskManager.checkStopLossTakeProfit(positions);
    for (const action of slTpActions) {
      log(`SL/TP: ${action.symbol} - ${action.reason}`);
      try {
        const result = await liquidatePosition(action.symbol);
        actions.push({ type: "close", symbol: action.symbol, reason: action.reason, result });
        botState.dailyTradeCount++;
      } catch (e) {
        log(`  Close failed: ${e.message}`);
      }
    }

    // Close underperformers (>1.5% loss)
    if (positions.length > 10) {
      const closed = await closeWorstPositions(positions, 0.015);
      for (const c of closed) {
        actions.push({ type: "close", symbol: c.symbol, reason: `Underperformer`, result: c.result });
        botState.dailyTradeCount++;
      }
      if (closed.length > 0) log(`Closed ${closed.length} underperformers`);
    }

    // Rotate stale positions
    if (positions.length >= 15) {
      const rotated = await rotateStalePositions(positions, equity);
      for (const r of rotated) {
        actions.push({ type: "rotate", symbol: r.symbol, reason: r.reason, result: r.result });
        botState.dailyTradeCount++;
      }
      if (rotated.length > 0) log(`Rotated ${rotated.length} stale positions`);
    }

    // v4: Rotate bottom 2 performers every cycle for learning velocity
    if (positions.length >= 8) {
      log("Rotating bottom performers for velocity...");
      const bottomRotated = await rotateBottomPerformers(positions, 2);
      for (const r of bottomRotated) {
        actions.push({ type: "rotate_bottom", symbol: r.symbol, reason: r.reason, result: r.result });
        botState.dailyTradeCount++;
      }
      if (bottomRotated.length > 0) log(`Rotated ${bottomRotated.length} bottom performers`);
    }

    // v4: Re-place missing SL/TP orders for all open positions
    try {
      const sltpResults = await replaceStopsAndTargets(positions, 0.03, 0.06);
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
        currentPositions = positions;
      }
    }

    let newTrades = [];
    if (tradingAllowed.allowed) {
      // --- CRYPTO ---
      log(`[CRYPTO] Scanning ${WATCH_LIST.length} symbols...`);

      const priceMap = {};
      let snapshotData;
      try {
        const dataSymbols = WATCH_LIST.map(s => toDataSymbol(s));
        let snaps = {};
        for (let i = 0; i < dataSymbols.length; i += 20) {
          const batch = dataSymbols.slice(i, i + 20);
          try {
            const batchResp = await getCryptoSnapshot(batch);
            if (batchResp?.snapshots) Object.assign(snaps, batchResp.snapshots);
          } catch (batchErr) {
            for (const sym of batch) {
              try {
                const singleResp = await getCryptoSnapshot([sym]);
                if (singleResp?.snapshots) Object.assign(snaps, singleResp.snapshots);
              } catch (e) { /* skip */ }
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
          log(`[CRYPTO] Got prices for ${Object.keys(priceMap).length / 2} symbols`);
          const movers = scanMovers(snaps);
          if (movers.length > 0) log(`[CRYPTO] Top movers: ${movers.length}`);
        }
      } catch (e) {
        log(`[CRYPTO] Snapshot failed: ${e.message}`);
      }

      const barsBySymbol = {};
      const bars15MBySymbol = {};
      const bars5MBySymbol = {};
      let fetched = 0;

      for (const symbol of WATCH_LIST) {
        try {
          const dataSymbol = toDataSymbol(symbol);

          try {
            const barsResp = await getCryptoBars(dataSymbol, "1Hour", 100);
            if (barsResp.bars) {
              const barsKey = Object.keys(barsResp.bars).find(k => k === dataSymbol || k === symbol || k === toTradeSymbol(symbol));
              if (barsKey && barsResp.bars[barsKey]) barsBySymbol[symbol] = barsResp.bars[barsKey];
            }
          } catch (e) { /* skip */ }

          try {
            const bars15MResp = await getCryptoBars(dataSymbol, "15Min", 100);
            if (bars15MResp.bars) {
              const barsKey = Object.keys(bars15MResp.bars).find(k => k === dataSymbol || k === symbol || k === toTradeSymbol(symbol));
              if (barsKey && bars15MResp.bars[barsKey]) bars15MBySymbol[symbol] = bars15MResp.bars[barsKey];
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
                    if (barsKey && bars5MResp.bars[barsKey]) bars5MBySymbol[symbol] = bars5MResp.bars[barsKey];
                  }
                } catch (e) { /* optional */ }
              }
            }
          }

          fetched++;
        } catch (e) {
          log(`  [CRYPTO] Failed ${symbol}: ${e.message}`);
        }
      }
      log(`[CRYPTO] Bars: ${fetched}/${WATCH_LIST.length} symbols`);

      // Fallback prices from bars
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
            }
          }
        }
      }

      const signals = scanSymbols(barsBySymbol, bars15MBySymbol, bars5MBySymbol);
      signalsFound = signals.length;
      log(`[CRYPTO] Signals: ${signalsFound}`);

      for (const signal of signals) {
        log(`  [CRYPTO] ${signal.symbol}: ${signal.signal.toUpperCase()} str=${(signal.strength * 100).toFixed(0)}% [${signal.strategy}]`);

        const tradeSym = toTradeSymbol(signal.symbol);
        const dataSym = toDataSymbol(signal.symbol);
        signal.currentPrice = priceMap[signal.symbol] || priceMap[dataSym] || priceMap[tradeSym] || 0;

        if (signal.currentPrice > 0 && currentPositions.length + newTrades.length < 25) {
          signal.symbol = tradeSym;
          const result = await executeSignal(signal, riskManager, equity, currentPositions);
          actions.push({ type: "trade", signal, result });
          if (result.success) {
            newTrades.push(signal);
            botState.totalTrades++;
            botState.dailyTradeCount++;
          }
        }
      }

      // --- STOCKS ---
      try {
        const marketOpen = await isMarketOpen();
        if (marketOpen) {
          log(`[STOCKS] Market open, scanning ${STOCK_UNIVERSE.length} stocks...`);
          const stockSnaps = await getStockSnapshot(STOCK_UNIVERSE);
          const stockMovers = scanStockMovers(stockSnaps?.snapshots || {});
          stockSignalsFound = stockMovers.length;
          log(`[STOCKS] Movers: ${stockSignalsFound}`);

          for (const mover of stockMovers.slice(0, 5)) {
            if (mover.direction === "up" && currentPositions.length + newTrades.length < 25) {
              try {
                const result = await executeStockSignal(
                  { symbol: mover.symbol, signal: "buy", price: mover.price, strategy: "stock-momentum" },
                  riskManager, equity, currentPositions
                );
                actions.push({ type: "stock-trade", signal: { symbol: mover.symbol }, result });
                if (result.success) {
                  newTrades.push({ symbol: mover.symbol });
                  botState.totalTrades++;
                  botState.dailyTradeCount++;
                }
              } catch (e) { /* continue */ }
            }
          }
        }
      } catch (e) {
        log(`[STOCKS] Scan failed: ${e.message}`);
      }
    }

    const riskSummary = riskManager.getRiskSummary(account, currentPositions);
    const learningInfo = getLearningState();

    botState.lastRun = runStart;
    botState.runHistory.push({
      time: runStart, equity, tradingAllowed: tradingAllowed.allowed,
      cryptoSignals: signalsFound, stockSignals: stockSignalsFound,
      tradesExecuted: newTrades.length, slTpCloses: slTpActions.length,
      dailyTrades: botState.dailyTradeCount,
    });
    botState.runHistory = botState.runHistory.slice(-100);

    const durationMs = Date.now() - runStartMs;
    try {
      const health = await recordRun({ success: true, durationMs });
      log(`Health: run #${health.totalRuns}, errors: ${health.consecutiveErrors}`);
    } catch (healthErr) {
      log(`Health: record failed - ${healthErr.message}`);
    }

    log(`=== Bot v4 Cron Done: ${botState.dailyTradeCount} daily trades ===`);

    return new Response(JSON.stringify({
      status: "ok",
      version: "4.0-high-volume",
      source: "cron",
      runAt: runStart,
      risk: riskSummary,
      tradingAllowed: tradingAllowed.allowed,
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
      },
      logs: logs.slice(-40),
      botState: {
        lastRun: botState.lastRun,
        totalTrades: botState.totalTrades,
        totalRuns: botState.runHistory.length,
        peakEquity: botState.peakEquity,
        dailyTrades: botState.dailyTradeCount,
      },
    }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    log(`FATAL: ${err.message}`);
    const errorDurationMs = Date.now() - runStartMs;
    try {
      const health = await recordRun({ success: false, error: err.message, durationMs: errorDurationMs });
      log(`Health: run #${health.totalRuns}, consecutive errors: ${health.consecutiveErrors}`);
    } catch (healthErr) {
      log(`Health: error record failed - ${healthErr.message}`);
    }

    return new Response(JSON.stringify({
      status: "error", version: "4.0-high-volume", source: "cron",
      error: err.message, stack: err.stack, logs,
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};