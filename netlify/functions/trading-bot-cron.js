// Trading Bot Cron v2 - LEARNING BOT
// Scheduled by Netlify every 5 minutes
// Same enhanced logic as trading-bot.js but for cron invocation

import { getAccount, getPositions, getPortfolioHistory, getCryptoBars, getCryptoSnapshot, getActivities, toDataSymbol, toTradeSymbol } from "./lib/alpaca-client.js";
import { RiskManager } from "./lib/risk-manager.js";
import { analyzeSymbol, scanSymbols, scanMovers, WATCH_LIST, recordTradeOutcome, getLearningState } from "./lib/strategy.js";
import { executeBuy, liquidatePosition, executeSignal, closeWorstPositions } from "./lib/executor.js";
import { recordRun } from "./lib/health-store.js";

// Bot state stored in memory (resets on cold start)
let botState = {
  lastRun: null,
  totalTrades: 0,
  totalPnl: 0,
  runHistory: [],
  peakEquity: 0,
};

export default async (req) => {
  const runStart = new Date().toISOString();
  const runStartMs = Date.now();
  const logs = [];
  const actions = [];
  let signalsFound = 0;

  const log = (msg) => {
    logs.push(`[${new Date().toISOString()}] ${msg}`);
    console.log(msg);
  };

  try {
    log("=== Trading Bot v2 Cron (LEARNING) Started ===");

    const account = await getAccount();
    const equity = parseFloat(account.equity);
    botState.peakEquity = Math.max(botState.peakEquity, equity);
    log(`Account: equity=$${equity.toFixed(2)}, cash=$${parseFloat(account.cash).toFixed(2)}, status=${account.status}`);

    const positions = await getPositions();
    log(`Open positions: ${positions.length}`);

    // Learn from recent trade outcomes
    try {
      const activities = await getActivities(new Date(Date.now() - 86400000).toISOString());
      if (Array.isArray(activities)) {
        for (const act of activities.slice(0, 50)) {
          if (act.side === "sell" && parseFloat(act.net_amount || 0) !== 0) {
            recordTradeOutcome(act.symbol || "unknown", "sell_close", parseFloat(act.net_amount || 0));
          }
        }
        log(`Learning: processed ${activities.length} recent activities`);
      }
    } catch (e) {
      log(`Learning: could not fetch activities - ${e.message}`);
    }

    const riskManager = new RiskManager({
      maxPositionPct: 0.05,
      dailyLossLimitPct: 0.03,
      maxDrawdownPct: 0.05,
      maxOpenPositions: 15,
      minTradeSizeUsd: 500,
      defaultStopLossPct: 0.03,
      defaultTakeProfitPct: 0.06,
      useAtrStops: true,
    });

    const portfolioHistory = await getPortfolioHistory("1M", "1D");
    const tradingAllowed = await riskManager.checkTradingAllowed(account, positions, portfolioHistory);
    log(`Risk check: ${tradingAllowed.allowed ? "ALLOWED" : "BLOCKED"} - ${tradingAllowed.reason}`);

    const slTpActions = riskManager.checkStopLossTakeProfit(positions);
    for (const action of slTpActions) {
      log(`STOP-LOSS/TAKE-PROFIT: ${action.symbol} - ${action.reason}`);
      const result = await liquidatePosition(action.symbol);
      actions.push({ type: "close", symbol: action.symbol, reason: action.reason, result });
      log(`  Result: ${result.message}`);
    }

    if (positions.length > 10) {
      log("Portfolio has 10+ positions, checking for underperformers...");
      const closed = await closeWorstPositions(positions, 0.025);
      for (const c of closed) {
        actions.push({ type: "close", symbol: c.symbol, reason: `Underperformer: ${(c.pnl * 100).toFixed(1)}%`, result: c.result });
      }
    }

    let newTrades = [];
    if (tradingAllowed.allowed) {
      log(`Scanning ${WATCH_LIST.length} watch list symbols for signals...`);
      
      const priceMap = {};
      let snapshotData;
      try {
        const dataSymbols = WATCH_LIST.map(s => toDataSymbol(s));
        snapshotData = await getCryptoSnapshot(dataSymbols);
        if (snapshotData?.snapshots) {
          for (const [key, snap] of Object.entries(snapshotData.snapshots)) {
            const price = parseFloat(snap.latestTrade?.p || snap.dailyBar?.c || 0);
            if (price > 0) {
              priceMap[key] = price;
              priceMap[key.replace("/", "")] = price;
            }
          }
          log(`Got prices for ${Object.keys(priceMap).length / 2} symbols`);
          const movers = scanMovers(snapshotData.snapshots);
          log(`Top movers: ${movers.length}`);
        }
      } catch (e) {
        log(`Snapshot fetch failed: ${e.message}`);
      }
      
      const barsBySymbol = {};
      const bars15MBySymbol = {};
      let fetched = 0;
      
      for (const symbol of WATCH_LIST) {
        try {
          const dataSymbol = toDataSymbol(symbol);
          const barsResp = await getCryptoBars(dataSymbol, "1Hour", 100);
          if (barsResp.bars) {
            const barsKey = Object.keys(barsResp.bars).find(k => k === dataSymbol || k === symbol || k === toTradeSymbol(symbol));
            if (barsKey && barsResp.bars[barsKey]) {
              barsBySymbol[symbol] = barsResp.bars[barsKey];
            }
          }
          try {
            const bars15MResp = await getCryptoBars(dataSymbol, "15Min", 100);
            if (bars15MResp.bars) {
              const barsKey = Object.keys(bars15MResp.bars).find(k => k === dataSymbol || k === symbol || k === toTradeSymbol(symbol));
              if (barsKey && bars15MResp.bars[barsKey]) {
                bars15MBySymbol[symbol] = bars15MResp.bars[barsKey];
              }
            }
          } catch (e) { /* 15M optional */ }
          fetched++;
        } catch (e) {
          log(`  Failed bars for ${symbol}: ${e.message}`);
        }
      }
      log(`Bar fetch: ${fetched}/${WATCH_LIST.length} symbols`);

      const signals = scanSymbols(barsBySymbol, bars15MBySymbol);
      signalsFound = signals.length;
      log(`Signals found: ${signalsFound}`);
      
      for (const signal of signals) {
        log(`  ${signal.symbol}: ${signal.signal.toUpperCase()} (str: ${(signal.strength * 100).toFixed(0)}%)`);
        
        const tradeSym = toTradeSymbol(signal.symbol);
        const dataSym = toDataSymbol(signal.symbol);
        signal.currentPrice = priceMap[signal.symbol] || priceMap[dataSym] || priceMap[tradeSym] || 0;
        
        if (signal.currentPrice > 0) {
          signal.symbol = tradeSym;
          const result = await executeSignal(signal, riskManager, equity, positions);
          actions.push({ type: "trade", signal, result });
          log(`  Executed: ${result.message}`);
          if (result.success) {
            newTrades.push(signal);
            botState.totalTrades++;
          }
        }
      }
    }

    const riskSummary = riskManager.getRiskSummary(account, positions);
    const learningInfo = getLearningState();

    botState.lastRun = runStart;
    botState.runHistory.push({
      time: runStart,
      equity,
      tradingAllowed: tradingAllowed.allowed,
      signalsFound,
      tradesExecuted: newTrades.length,
      slTpCloses: slTpActions.length,
    });
    botState.runHistory = botState.runHistory.slice(-50);

    log("=== Trading Bot v2 Cron Completed ===");

    // Record successful run to persistent health store
    const durationMs = Date.now() - runStartMs;
    const health = await recordRun({ success: true, durationMs });
    log(`Health: recorded run #${health.totalRuns}, consecutive errors: ${health.consecutiveErrors}`);

    return new Response(JSON.stringify({
      status: "ok",
      version: "2.0-learning",
      source: "cron",
      runAt: runStart,
      risk: riskSummary,
      tradingAllowed: tradingAllowed.allowed,
      riskReason: tradingAllowed.reason,
      positions: positions.length,
      actions: actions.map(a => ({
        type: a.type,
        symbol: a.type === "close" ? a.symbol : a.signal?.symbol,
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
      logs: logs.slice(-30),
      botState: {
        lastRun: botState.lastRun,
        totalTrades: botState.totalTrades,
        totalRuns: botState.runHistory.length,
        peakEquity: botState.peakEquity,
      },
    }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    log(`FATAL ERROR: ${err.message}`);

    // Record failed run to persistent health store
    const durationMs = Date.now() - runStartMs;
    try {
      const health = await recordRun({ success: false, error: err.message, durationMs });
      log(`Health: recorded failed run, consecutive errors: ${health.consecutiveErrors}`);
    } catch (healthErr) {
      log(`Health: failed to record error - ${healthErr.message}`);
    }

    return new Response(JSON.stringify({
      status: "error",
      version: "2.0-learning",
      source: "cron",
      error: err.message,
      stack: err.stack,
      logs,
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};