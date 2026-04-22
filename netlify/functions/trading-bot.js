// Trading Bot - Scheduled Netlify Function
// Runs every 5 minutes, scans crypto pairs, applies risk management, executes trades
// Crypto only, paper trading, conservative 2-8% daily target

import { getAccount, getPositions, getPortfolioHistory, getCryptoBars, getCryptoSnapshot } from "./lib/alpaca-client.js";
import { RiskManager } from "./lib/risk-manager.js";
import { analyzeSymbol, scanSymbols, WATCH_LIST } from "./lib/strategy.js";
import { executeBuy, liquidatePosition, executeSignal } from "./lib/executor.js";

// Bot state stored in memory (resets on cold start - for persistence use KV store)
let botState = {
  lastRun: null,
  totalTrades: 0,
  totalPnl: 0,
  runHistory: [],
};

export default async (req) => {
  const runStart = new Date().toISOString();
  const logs = [];
  const actions = [];

  const log = (msg) => {
    logs.push(`[${new Date().toISOString()}] ${msg}`);
    console.log(msg);
  };

  try {
    log("=== Trading Bot Started ===");

    // 1. Get account state
    const account = await getAccount();
    const equity = parseFloat(account.equity);
    log(`Account: equity=$${equity.toFixed(2)}, cash=$${parseFloat(account.cash).toFixed(2)}, status=${account.status}`);

    // 2. Get current positions
    const positions = await getPositions();
    log(`Open positions: ${positions.length}`);

    // 3. Initialize risk manager
    const riskManager = new RiskManager({
      maxPositionPct: 0.10,
      dailyLossLimitPct: 0.03,
      maxDrawdownPct: 0.05,
      maxOpenPositions: 5,
      defaultStopLossPct: 0.02,
      defaultTakeProfitPct: 0.04,
    });

    // 4. Check if trading is allowed
    const portfolioHistory = await getPortfolioHistory("1M", "1D");
    const tradingAllowed = await riskManager.checkTradingAllowed(account, positions, portfolioHistory);
    log(`Risk check: ${tradingAllowed.allowed ? "ALLOWED" : "BLOCKED"} - ${tradingAllowed.reason}`);

    // 5. Check stop-loss / take-profit on existing positions
    const slTpActions = riskManager.checkStopLossTakeProfit(positions);
    for (const action of slTpActions) {
      log(`STOP-LOSS/TAKE-PROFIT: ${action.symbol} - ${action.reason}`);
      const result = await liquidatePosition(action.symbol);
      actions.push({ type: "close", symbol: action.symbol, reason: action.reason, result });
      log(`  Result: ${result.message}`);
    }

    // 6. If trading is allowed, scan for new signals
    let newTrades = [];
    if (tradingAllowed.allowed) {
      log("Scanning watch list for signals...");
      
      // Fetch bars for all watchlist symbols (1-hour timeframe, last 100 bars)
      const barsBySymbol = {};
      const snapshotData = await getCryptoSnapshot(WATCH_LIST.map(s => s.replace("/", "")));
      
      for (const symbol of WATCH_LIST) {
        try {
          const alpacaSymbol = symbol.replace("/", "");
          const barsResp = await getCryptoBars(alpacaSymbol, "1Hour", 100);
          if (barsResp.bars && barsResp.bars[alpacaSymbol]) {
            barsBySymbol[symbol] = barsResp.bars[alpacaSymbol];
          }
        } catch (e) {
          log(`  Failed to fetch bars for ${symbol}: ${e.message}`);
        }
      }

      // Analyze signals
      const signals = scanSymbols(barsBySymbol);
      log(`Signals found: ${signals.length}`);
      
      for (const signal of signals) {
        log(`  ${signal.symbol}: ${signal.signal.toUpperCase()} (strength: ${(signal.strength * 100).toFixed(0)}%) ${signal.reasons.join(", ")}`);
        
        // Attach current price from snapshot
        const alpacaSymbol = signal.symbol.replace("/", "");
        if (snapshotData?.snapshots?.[alpacaSymbol]) {
          signal.currentPrice = parseFloat(snapshotData.snapshots[alpacaSymbol].latestTrade?.p || 0);
        }
        
        // Only trade strong signals (strength >= 0.5)
        if (signal.strength >= 0.5 && signal.currentPrice > 0) {
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

    // 7. Build risk summary
    const riskSummary = riskManager.getRiskSummary(account, positions);

    // Update bot state
    botState.lastRun = runStart;
    botState.runHistory.push({
      time: runStart,
      equity,
      tradingAllowed: tradingAllowed.allowed,
      signalsFound: actions.length,
      tradesExecuted: newTrades.length,
      slTpCloses: slTpActions.length,
    });
    botState.runHistory = botState.runHistory.slice(-50); // Keep last 50 runs

    const response = {
      status: "ok",
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
      logs: logs.slice(-20), // Last 20 log entries
      botState: {
        lastRun: botState.lastRun,
        totalTrades: botState.totalTrades,
        totalRuns: botState.runHistory.length,
      },
    };

    log("=== Trading Bot Completed ===");

    return new Response(JSON.stringify(response, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    log(`FATAL ERROR: ${err.message}`);
    return new Response(JSON.stringify({
      status: "error",
      error: err.message,
      stack: err.stack,
      logs,
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

// No config export needed — function is invoked via Netlify redirect rule in netlify.toml