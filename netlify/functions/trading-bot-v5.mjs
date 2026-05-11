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

import { getAccount, getPositions, getPortfolioHistory, getCryptoBars, getCryptoSnapshot, getStockSnapshot, isMarketOpen, toDataSymbol, toTradeSymbol } from "./lib/alpaca-client.mjs";
import { RiskManager } from "./lib/risk-manager.mjs";
import { analyzeSymbol, scanSymbols, scanMovers, scanStockMovers, WATCH_LIST, STOCK_UNIVERSE } from "./lib/strategy.mjs";
import { updateMarketRegime, filterSignals, getLearningSummary, recordTradeOutcome } from "./lib/learning-system.mjs";
import { executeBuy, liquidatePosition, executeSignal, executeStockSignal, closeWorstPositions, rotateStalePositions, rotateBottomPerformers, replaceStopsAndTargets, cancelSellOrders, cancelStaleOrders } from "./lib/executor.mjs";
import { recordRun } from "./lib/health-store.mjs";
import { loadBotState, saveBotState, loadLearningState, saveLearningState, savePositionSnapshot, savePositionMeta, loadPositionMeta } from "./lib/state-store.mjs";
import { extractFeatures, loadNNWeights, saveNNWeights, trainNeuralNetwork } from "./lib/neural-network.mjs";

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

  let botState = { lastRun: runStart, totalTrades: 0, runHistory: [], peakEquity: 0, dailyTradeCount: 0, dailyResetDate: null };
  let learningState;

  try {
    log("=== Trading Bot v5 (PERSISTENT STATE) Started ===");

    // ============================================================
    // PHASE 0: LOAD PERSISTENT STATE
    // Bot state (trade counts, peak equity, daily stats) is loaded
    // from Netlify Blobs, not lost on cold starts anymore.
    // Learning state is also loaded; if stale, rebuilt from API.
    // ============================================================
    botState = await loadBotState();
    log(`[STATE] Loaded bot state: totalTrades=${botState.totalTrades}, dailyTrades=${botState.dailyTradeCount}, peakEquity=$${botState.peakEquity?.toFixed(2) || '0'}`);

    // Load persisted learning state (adaptive params)
    learningState = await loadLearningState();
    log(`[STATE] Loaded learning state: ${learningState.totalTrades} trades, WR=${(learningState.winRate * 100).toFixed(1)}%, regime=${learningState.currentRegime}`);

    // Load NN weights (may be null if not trained yet)
    if (!learningState.nnWeights) {
      learningState.nnWeights = await loadNNWeights();
    }
    if (learningState.nnWeights) {
      log(`[STATE] NN weights loaded (${learningState.nnMetrics?.trained ? `trained ${learningState.nnMetrics.trainedAt}` : 'present'})`);
    }

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

    // Load position strategy metadata so SL/TP checks use correct per-strategy thresholds
    const positionMeta = await loadPositionMeta();
    for (const pos of positions) {
      pos.strategy = positionMeta[pos.symbol] || "momentum";
    }
    log(`[STATE] Loaded position metadata for ${Object.keys(positionMeta).length} symbols`);

    // Save position snapshot for change detection
    await savePositionSnapshot(positions);

    // 3. Record trade outcomes from position closes (DEF-13: reward-based learning).
    // Crypto FILL activities lack net_amount, so we learn from position data at close time
    // instead of parsing the activity feed. This gives exact PnL from Alpaca's position tracking.
    // Maps symbol → feature vector for NN training. Populated when signals are executed,
    // consumed when positions close so we know the features at entry time.
    const pendingFeatures = {};
    let nnShouldTrain = false;

    const recordPositionClose = (position, strategy = null) => {
      strategy = strategy || position.strategy || "momentum";
      const pnl = parseFloat(position.unrealized_pl || 0);
      const pnlPct = parseFloat(position.unrealized_plpc || 0);
      const qty = parseFloat(position.qty || 0);
      const price = parseFloat(position.current_price || position.avg_entry_price || 0);
      if (qty === 0 || price === 0) return { shouldTrain: false };
      const tradeValue = qty * price;
      const actualPnlPct = tradeValue > 0 ? pnl / (tradeValue - pnl) : pnlPct;
      const cleanSymbol = position.symbol.replace("/", "");
      const features = pendingFeatures[position.symbol] || pendingFeatures[cleanSymbol];
      const result = recordTradeOutcome(learningState, {
        symbol: cleanSymbol,
        strategy,
        pnl,
        pnlPct: actualPnlPct,
        holdingPeriodMins: 120,
        atrPctAtEntry: 2,
        timestamp: Date.now(),
        features: features || undefined,
      });
      // Clean up pending features after use
      delete pendingFeatures[position.symbol];
      delete pendingFeatures[cleanSymbol];
      return result;
    };

    try { await saveLearningState(learningState); } catch (e) { /* best effort */ }

    // 4. Risk manager - v6 config: 3% SL / 4% TP for achievable targets
    const riskManager = new RiskManager({
      maxPositionPct: 0.10,       // 10% per position
      maxBuyValueUsd: 5000,
      maxPositionValueUsd: 7000,
      dailyLossLimitPct: 0.05,
      maxDrawdownPct: 0.10,
      maxOpenPositions: 25,
      minTradeSizeUsd: 500,
      defaultStopLossPct: 0.03,   // 3% SL
      defaultTakeProfitPct: 0.04, // 4% TP
      useAtrStops: true,
    });

    // 5. Check if trading is allowed
    const portfolioHistory = await getPortfolioHistory("1M", "1D");
    const tradingAllowed = await riskManager.checkTradingAllowed(account, positions, portfolioHistory);
    log(`Risk check: ${tradingAllowed.allowed ? "ALLOWED" : "BLOCKED"} - ${tradingAllowed.reason}`);

    // 6. Cancel stale unfilled orders (>8h old) to free up locked capital
    try {
      const staleCancelled = await cancelStaleOrders(8);
      if (staleCancelled.length > 0) {
        log(`Cancelled ${staleCancelled.length} stale unfilled orders (${staleCancelled.map(o => `${o.symbol}(${o.ageHours}h)`).join(", ")})`);
        for (const c of staleCancelled) {
          actions.push({ type: "cancel_stale", symbol: c.symbol, reason: `Unfilled ${c.ageHours}h`, result: { success: true } });
        }
      }
    } catch (e) {
      log(`Stale order cancel failed: ${e.message}`);
    }

    // 7. Check stop-loss / take-profit on existing positions
    // liquidatePosition handles settlement (cancels SL orders, tries closePosition).
    const slTpActions = riskManager.checkStopLossTakeProfit(positions);
    for (const action of slTpActions) {
      log(`STOP-LOSS/TAKE-PROFIT: ${action.symbol} - ${action.reason}`);
      const posForLearning = positions.find(p => p.symbol === action.symbol);
      try {
        const result = await liquidatePosition(action.symbol);
        actions.push({ type: "close", symbol: action.symbol, reason: action.reason, result });
        botState.dailyTradeCount++;
        log(`  Result: ${result.message}`);
        if (posForLearning) {
          const r = recordPositionClose(posForLearning);
          if (r.shouldTrain) nnShouldTrain = true;
        }
      } catch (e) {
        log(`  Close failed: ${e.message}`);
      }
    }

    // 6b. Close deep underperformers — only at -1.5% loss, only when many positions open
    if (positions.length > 8) {
      log("Closing underperformers (threshold: -1.5%)...");
      const closed = await closeWorstPositions(positions, 0.015);
      for (const c of closed) {
        actions.push({ type: "close", symbol: c.symbol, reason: `Underperformer: ${(c.pnl * 100).toFixed(1)}%`, result: c.result });
        botState.dailyTradeCount++;
        const pos = positions.find(p => p.symbol === c.symbol);
        if (pos) {
          const r = recordPositionClose(pos);
          if (r.shouldTrain) nnShouldTrain = true;
        }
      }
      if (closed.length > 0) log(`Closed ${closed.length} underperformers`);
    }

    // 6c. Rotate stale/tiny positions — less aggressive, only when many positions open
    if (positions.length >= 10) {
      log("Rotating stale positions...");
      const rotated = await rotateStalePositions(positions, equity);
      for (const r of rotated) {
        actions.push({ type: "rotate", symbol: r.symbol, reason: r.reason, result: r.result });
        botState.dailyTradeCount++;
        const pos = positions.find(p => p.symbol === r.symbol);
        if (pos) {
          const r = recordPositionClose(pos);
          if (r.shouldTrain) nnShouldTrain = true;
        }
      }
      if (rotated.length > 0) log(`Rotated ${rotated.length} stale positions`);
    }

    // 6d. Rotate bottom 1 performer only when many positions open
    if (positions.length >= 10) {
      log("Rotating bottom performer...");
      const bottomRotated = await rotateBottomPerformers(positions, 1);
      for (const r of bottomRotated) {
        actions.push({ type: "rotate_bottom", symbol: r.symbol, reason: r.reason, result: r.result });
        botState.dailyTradeCount++;
        const pos = positions.find(p => p.symbol === r.symbol);
        if (pos) {
          const r = recordPositionClose(pos);
          if (r.shouldTrain) nnShouldTrain = true;
        }
      }
      if (bottomRotated.length > 0) log(`Rotated ${bottomRotated.length} bottom performer`);
    }

    // 6e. Re-place missing SL/TP orders for all open positions (3% SL, 4% TP)
    try {
      const sltpResults = await replaceStopsAndTargets(positions, 0.03, 0.04);
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

      // DEF-13: Update market regime from top symbols
      updateMarketRegime(learningState, barsBySymbol);
      log(`[CRYPTO] Market regime: ${learningState.currentRegime}`);

      // Scan for signals using multi-strategy, multi-timeframe analysis
      const rawSignals = scanSymbols(barsBySymbol, bars15MBySymbol, bars5MBySymbol, learningState.adaptiveParams);

      // DEF-13 NN: Extract feature vectors for each signal before filtering
      for (const signal of rawSignals) {
        const bars = barsBySymbol[signal.symbol];
        signal.features = extractFeatures(signal, bars, learningState.currentRegime);
      }

      const signals = filterSignals(learningState, rawSignals, learningState.nnWeights);
      signalsFound = signals.length;
      log(`[CRYPTO] Signals found: ${rawSignals.length} raw → ${signalsFound} after learning filter`);
      
      // Execute signals
      for (const signal of signals) {
        log(`  [CRYPTO] ${signal.symbol}: ${signal.signal.toUpperCase()} str=${(signal.adjustedStrength * 100).toFixed(0)}% (raw=${(signal.strength * 100).toFixed(0)}%) [${signal.strategy}${signal.confirmed ? " confirmed" : ""}] sc=${(signal.strategyConfidence * 100).toFixed(0)}% - ${signal.reasons.slice(0, 3).join(", ")}`);
        
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
            // Store features for NN training when this position closes
            if (signal.features) {
              pendingFeatures[tradeSym] = signal.features;
            }
            // Store strategy metadata for per-strategy SL/TP checks
            if (signal.strategy) {
              try { await savePositionMeta(tradeSym, signal.strategy); } catch (e) { /* best effort */ }
            }
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
                  try { await savePositionMeta(mover.symbol, "stock-momentum"); } catch (e) { /* best effort */ }
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
    const learningInfo = getLearningSummary(learningState);

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
    // DEF-13 NN: Trigger neural network training if buffer threshold met
    // ============================================================
    if (nnShouldTrain && learningState.tradeBuffer && learningState.tradeBuffer.length >= 50) {
      log(`[NN] Training triggered — buffer: ${learningState.tradeBuffer.length} trades`);
      try {
        const result = trainNeuralNetwork(learningState.tradeBuffer, learningState.nnWeights);
        learningState.nnWeights = result.weights;
        learningState.nnMetrics = result.metrics;
        learningState.lastTrainCount = learningState.tradeBuffer.length;
        await saveNNWeights(result.weights);
        log(`[NN] Training complete — testLoss=${result.metrics.testLoss?.toFixed(6)}, testMAE=${result.metrics.testMae?.toFixed(6)}`);
      } catch (e) {
        log(`[NN] Training failed: ${e.message}`);
      }
    }

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
        totalTrades: learningInfo.totalTrades,
        winRate: typeof learningInfo.winRate === 'number' ? learningInfo.winRate.toFixed(2) : learningInfo.winRate,
        averageReward: learningInfo.averageReward?.toFixed(3),
        currentRegime: learningInfo.currentRegime,
        adaptationGeneration: learningInfo.adaptationGeneration,
        explorationRate: learningInfo.explorationRate,
        strategyConfidence: learningInfo.strategies,
        strategyWeights: learningInfo.strategyWeights,
        topSymbols: learningInfo.topSymbols,
        blacklistedCount: learningInfo.blacklistedCount,
        adaptiveParams: learningInfo.adaptiveParams,
        lastAdaptation: learningInfo.lastAdaptation,
        nn: learningInfo.nn,
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
// DEF-13: Learning System with Rewards
// The learning state is managed by learning-system.mjs.
// - Loaded from Netlify Blobs at startup via loadLearningState()
// - Trade outcomes are recorded via recordTradeOutcome() from learning-system.mjs
// - Adaptive params are passed to strategy functions directly
// - getLearningSummary() provides the dashboard-ready summary
// - Saved back to Blobs via saveLearningState()
// ============================================================