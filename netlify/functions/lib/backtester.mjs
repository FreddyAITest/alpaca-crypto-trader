// Backtesting Harness - DEF-13 deliverable #4
// Walk-forward backtester that measures strategy performance with before/after
// metrics when the learning system proposes parameter changes.
//
// Design:
// 1. Walk through historical bars chronologically
// 2. At each bar, run strategy using only data up to that point (no look-ahead)
// 3. Simulate fills at next bar's open (realistic slippage)
// 4. Track open positions with SL/TP checks each bar
// 5. Compute: total return, Sharpe ratio, win rate, max drawdown, profit factor

import { analyzeSymbol, DEFAULT_PARAMS } from "./strategy.mjs";

// ============================================================
// BACKTEST ENGINE
// ============================================================

/**
 * Run a walk-forward backtest on a single symbol.
 *
 * @param {Array} bars - OHLCV bars sorted chronologically (oldest first)
 * @param {Object} params - Strategy parameters to test
 * @param {Object} options - Backtest configuration
 * @param {number} options.initialEquity - Starting capital (default 100000)
 * @param {number} options.positionSizePct - Fraction of equity per trade (default 0.10)
 * @param {number} options.stopLossPct - Stop-loss as decimal (default 0.03)
 * @param {number} options.takeProfitPct - Take-profit as decimal (default 0.04)
 * @param {number} options.maxPositions - Max concurrent positions (default 5)
 * @param {number} options.minBars - Minimum bars needed before trading starts (default 50)
 * @param {boolean} options.longOnly - Only take long signals (default true)
 * @returns {Object} backtest results
 */
export function runBacktest(bars, params = DEFAULT_PARAMS, options = {}) {
  const {
    initialEquity = 100000,
    positionSizePct = 0.10,
    stopLossPct = 0.03,
    takeProfitPct = 0.04,
    maxPositions = 5,
    minBars = 50,
    longOnly = true,
  } = options;

  if (!bars || bars.length < minBars) {
    return { error: `Need at least ${minBars} bars, got ${bars?.length || 0}` };
  }

  let equity = initialEquity;
  const equityCurve = [initialEquity];
  const trades = [];
  const openPositions = [];

  // Pre-compute closes/opens for quick access
  const closes = bars.map(b => parseFloat(b.c || b.close));
  const opens = bars.map(b => parseFloat(b.o || b.open));
  const highs = bars.map(b => parseFloat(b.h || b.high));
  const lows = bars.map(b => parseFloat(b.l || b.low));

  for (let i = minBars; i < bars.length - 1; i++) {
    // Step 1: Check SL/TP on open positions using THIS bar's OHLC
    checkStopLossTakeProfit(openPositions, bars[i], stopLossPct, takeProfitPct, trades, i);

    // Step 2: Remove closed positions
    for (let p = openPositions.length - 1; p >= 0; p--) {
      if (openPositions[p].closed) {
        equity += openPositions[p].realizedPnl;
        openPositions.splice(p, 1);
      }
    }

    // Step 3: Run strategy on data up to bar i (no look-ahead)
    const windowBars = bars.slice(0, i + 1);
    const analysis = analyzeSymbol(windowBars, params);

    // Step 4: If signal and room for new positions, enter at next bar's open
    if (analysis.signal === "buy" && openPositions.length < maxPositions) {
      const entryPrice = opens[i + 1]; // Next bar open (realistic fill)
      if (entryPrice > 0) {
        const positionValue = equity * positionSizePct;
        const qty = positionValue / entryPrice;
        openPositions.push({
          entryPrice,
          qty,
          entryBar: i + 1,
          strategy: analysis.strategy,
          strength: analysis.strength,
          stopLoss: entryPrice * (1 - stopLossPct),
          takeProfit: entryPrice * (1 + takeProfitPct),
          closed: false,
          realizedPnl: 0,
        });
      }
    }

    // Step 5: Mark-to-market equity (unrealized P&L on open positions)
    let unrealizedPnl = 0;
    for (const pos of openPositions) {
      unrealizedPnl += (closes[i] - pos.entryPrice) * pos.qty;
    }
    equityCurve.push(equity + unrealizedPnl);

    // Step 6: If we're at the last bar, close all open positions
    if (i === bars.length - 2) {
      for (const pos of openPositions) {
        const exitPrice = closes[closes.length - 1];
        const pnl = (exitPrice - pos.entryPrice) * pos.qty;
        const pnlPct = (exitPrice - pos.entryPrice) / pos.entryPrice;
        trades.push({
          entryPrice: pos.entryPrice,
          exitPrice,
          entryBar: pos.entryBar,
          exitBar: closes.length - 1,
          pnl,
          pnlPct,
          strategy: pos.strategy,
          holdingBars: closes.length - 1 - pos.entryBar,
          exitReason: "end_of_test",
        });
        equity += pnl;
      }
      openPositions.length = 0;
    }
  }

  // Compute metrics
  const metrics = computeMetrics(trades, equityCurve, initialEquity);

  return {
    metrics,
    trades,
    equityCurve,
    params: { ...params },
    options: { initialEquity, positionSizePct, stopLossPct, takeProfitPct, maxPositions },
  };
}

/**
 * Run parameter comparison: test two parameter sets on the same data.
 * Returns a before/after comparison report.
 */
export function compareParams(bars, beforeParams, afterParams, options = {}) {
  const before = runBacktest(bars, beforeParams, options);
  const after = runBacktest(bars, afterParams, options);

  if (before.error || after.error) {
    return { error: before.error || after.error };
  }

  const improvement = {
    totalReturn: after.metrics.totalReturn - before.metrics.totalReturn,
    sharpeRatio: after.metrics.sharpeRatio - before.metrics.sharpeRatio,
    winRate: after.metrics.winRate - before.metrics.winRate,
    profitFactor: after.metrics.profitFactor - before.metrics.profitFactor,
    maxDrawdown: after.metrics.maxDrawdown - before.metrics.maxDrawdown,
    avgTradeReturn: after.metrics.avgTradeReturn - before.metrics.avgTradeReturn,
    totalTrades: after.metrics.totalTrades - before.metrics.totalTrades,
  };

  return {
    before: { params: beforeParams, metrics: before.metrics },
    after: { params: afterParams, metrics: after.metrics },
    improvement,
    improved: improvement.sharpeRatio > 0 || improvement.totalReturn > 0,
    summary: summarizeComparison(improvement),
  };
}

/**
 * Run a multi-symbol backtest across a watch list.
 * Tests each symbol independently and aggregates results.
 */
export function runMultiBacktest(barsBySymbol, params = DEFAULT_PARAMS, options = {}) {
  const results = {};
  let totalTrades = 0;
  let totalPnl = 0;
  const allEquityCurves = [];

  for (const [symbol, bars] of Object.entries(barsBySymbol)) {
    const result = runBacktest(bars, params, { ...options });
    if (!result.error) {
      results[symbol] = result;
      totalTrades += result.metrics.totalTrades;
      totalPnl += result.metrics.totalPnl;
      allEquityCurves.push(result.equityCurve);
    }
  }

  // Aggregate metrics
  const symbolCount = Object.keys(results).length;
  const aggregateEquityCurve = aggregateEquityCurves(allEquityCurves);

  return {
    symbolResults: results,
    aggregateMetrics: {
      symbolsTested: symbolCount,
      totalTrades,
      totalPnl,
      avgTradesPerSymbol: symbolCount > 0 ? totalTrades / symbolCount : 0,
      avgPnlPerSymbol: symbolCount > 0 ? totalPnl / symbolCount : 0,
    },
    aggregateEquityCurve,
  };
}

// ============================================================
// HELPERS
// ============================================================

function checkStopLossTakeProfit(positions, bar, slPct, tpPct, trades, barIndex) {
  const high = parseFloat(bar.h || bar.high);
  const low = parseFloat(bar.l || bar.low);
  const close = parseFloat(bar.c || bar.close);

  for (const pos of positions) {
    if (pos.closed) continue;

    // Check if SL or TP was hit during this bar
    // Use OHLC intra-bar logic: if low <= SL, assume SL fill at SL price
    // If high >= TP, assume TP fill at TP price
    if (low <= pos.stopLoss) {
      const exitPrice = pos.stopLoss;
      const pnl = (exitPrice - pos.entryPrice) * pos.qty;
      const pnlPct = (exitPrice - pos.entryPrice) / pos.entryPrice;
      trades.push({
        entryPrice: pos.entryPrice,
        exitPrice,
        entryBar: pos.entryBar,
        exitBar: barIndex,
        pnl,
        pnlPct,
        strategy: pos.strategy,
        holdingBars: barIndex - pos.entryBar,
        exitReason: "stop_loss",
      });
      pos.closed = true;
      pos.realizedPnl = pnl;
    } else if (high >= pos.takeProfit) {
      const exitPrice = pos.takeProfit;
      const pnl = (exitPrice - pos.entryPrice) * pos.qty;
      const pnlPct = (exitPrice - pos.entryPrice) / pos.entryPrice;
      trades.push({
        entryPrice: pos.entryPrice,
        exitPrice,
        entryBar: pos.entryBar,
        exitBar: barIndex,
        pnl,
        pnlPct,
        strategy: pos.strategy,
        holdingBars: barIndex - pos.entryBar,
        exitReason: "take_profit",
      });
      pos.closed = true;
      pos.realizedPnl = pnl;
    }
  }
}

function computeMetrics(trades, equityCurve, initialEquity) {
  const finalEquity = equityCurve[equityCurve.length - 1];
  const totalReturn = (finalEquity - initialEquity) / initialEquity;
  const totalPnl = finalEquity - initialEquity;

  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const winRate = trades.length > 0 ? wins.length / trades.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;
  const avgTradeReturn = trades.length > 0 ? trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length : 0;

  // Profit factor: gross profit / gross loss
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : trades.length > 0 ? Infinity : 0;

  // Sharpe ratio: mean(excess_return) / std(excess_return), annualized
  const returns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    if (equityCurve[i - 1] > 0) {
      returns.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1]);
    }
  }
  const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length > 1
    ? returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (returns.length - 1)
    : 0;
  const stdReturn = Math.sqrt(variance);
  // Annualize: crypto runs 24/7 but bar intervals vary. Assume 1H bars → ~8760/year.
  // We scale based on the number of bars, which the caller should note.
  const periodsPerYear = 8760; // Hourly bars in a year
  const sharpeRatio = stdReturn > 0 ? (meanReturn / stdReturn) * Math.sqrt(periodsPerYear) : 0;

  // Max drawdown
  let peak = equityCurve[0];
  let maxDrawdown = 0;
  for (const e of equityCurve) {
    if (e > peak) peak = e;
    const dd = (e - peak) / peak;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }

  // Strategy breakdown
  const strategyBreakdown = {};
  for (const t of trades) {
    const s = t.strategy || "unknown";
    if (!strategyBreakdown[s]) {
      strategyBreakdown[s] = { trades: 0, wins: 0, totalPnl: 0, totalPnlPct: 0 };
    }
    strategyBreakdown[s].trades++;
    if (t.pnl > 0) strategyBreakdown[s].wins++;
    strategyBreakdown[s].totalPnl += t.pnl;
    strategyBreakdown[s].totalPnlPct += t.pnlPct;
  }

  return {
    initialEquity,
    finalEquity,
    totalReturn,
    totalPnl,
    totalTrades: trades.length,
    winRate,
    avgWin,
    avgLoss,
    avgTradeReturn,
    profitFactor,
    sharpeRatio,
    maxDrawdown,
    bestTrade: trades.length > 0 ? Math.max(...trades.map(t => t.pnlPct)) : 0,
    worstTrade: trades.length > 0 ? Math.min(...trades.map(t => t.pnlPct)) : 0,
    avgHoldingBars: trades.length > 0 ? trades.reduce((s, t) => s + t.holdingBars, 0) / trades.length : 0,
    exitReasons: trades.reduce((acc, t) => {
      acc[t.exitReason] = (acc[t.exitReason] || 0) + 1;
      return acc;
    }, {}),
    strategyBreakdown,
  };
}

function summarizeComparison(improvement) {
  const parts = [];
  if (improvement.sharpeRatio > 0) parts.push(`Sharpe +${improvement.sharpeRatio.toFixed(2)}`);
  else if (improvement.sharpeRatio < 0) parts.push(`Sharpe ${improvement.sharpeRatio.toFixed(2)}`);

  if (improvement.totalReturn > 0) parts.push(`return +${(improvement.totalReturn * 100).toFixed(1)}%`);
  else if (improvement.totalReturn < 0) parts.push(`return ${(improvement.totalReturn * 100).toFixed(1)}%`);

  if (improvement.winRate !== 0) parts.push(`WR ${improvement.winRate > 0 ? '+' : ''}${(improvement.winRate * 100).toFixed(1)}%`);

  if (improvement.profitFactor > 0) parts.push(`PF +${improvement.profitFactor.toFixed(2)}`);

  return parts.join(', ') || 'No change';
}

function aggregateEquityCurves(curves) {
  if (curves.length === 0) return [];
  const maxLen = Math.max(...curves.map(c => c.length));
  const result = new Array(maxLen).fill(0);
  for (let i = 0; i < maxLen; i++) {
    let sum = 0, count = 0;
    for (const curve of curves) {
      if (i < curve.length) { sum += curve[i]; count++; }
    }
    result[i] = count > 0 ? sum / count : result[i - 1] || 0;
  }
  return result;
}
