// Trade Performance Analytics - Netlify Function (v2)
// Computes win rate, profit factor, Sharpe ratio, max drawdown, best/worst trades
// Data sources: Alpaca activities API (FILL type) + portfolio history

import { getAccount, getPositions, getActivities, getPortfolioHistory } from "./lib/alpaca-client.mjs";

function aggregateTrades(activities) {
  // Group fills by order_id to reconstruct full trades
  const tradesMap = {};
  for (const fill of activities) {
    const oid = fill.order_id || fill.id;
    if (!tradesMap[oid]) {
      tradesMap[oid] = {
        order_id: oid,
        symbol: fill.symbol,
        side: fill.side,
        fills: [],
        totalQty: 0,
        totalCost: 0,
        timestamps: [],
      };
    }
    const qty = parseFloat(fill.qty || fill.quantity || 0);
    const price = parseFloat(fill.price || fill.fill_price || 0);
    tradesMap[oid].fills.push({ qty, price, timestamp: fill.timestamp || fill.transaction_time });
    tradesMap[oid].totalQty += qty;
    tradesMap[oid].totalCost += qty * price;
    tradesMap[oid].timestamps.push(fill.timestamp || fill.transaction_time);
  }

  // Compute average fill price per trade, and P&L from current positions
  return Object.values(tradesMap).map(t => ({
    ...t,
    avgPrice: t.totalQty > 0 ? t.totalCost / t.totalQty : 0,
    lastTimestamp: t.timestamps.sort().pop() || new Date().toISOString(),
  }));
}

function computeMetrics(trades, positions, portfolioHistory) {
  // Build a position book to compute realized P&L per closed trade
  const positionBook = {}; // symbol -> { qty, totalCost }
  const closedTrades = [];

  // Sort by timestamp
  const sortedTrades = [...trades].sort((a, b) =>
    new Date(a.lastTimestamp) - new Date(b.lastTimestamp)
  );

  for (const t of sortedTrades) {
    const sym = t.symbol;
    if (!positionBook[sym]) positionBook[sym] = { qty: 0, totalCost: 0 };

    if (t.side === 'buy') {
      positionBook[sym].qty += t.totalQty;
      positionBook[sym].totalCost += t.totalCost;
    } else {
      // Closing (sell) => realize P&L
      const avgEntry = positionBook[sym].qty > 0 ? positionBook[sym].totalCost / positionBook[sym].qty : 0;
      const realizedPnl = (t.avgPrice - avgEntry) * t.totalQty;
      closedTrades.push({
        symbol: t.symbol,
        side: t.side,
        qty: t.totalQty,
        entryPrice: avgEntry,
        exitPrice: t.avgPrice,
        realizedPnl,
        timestamp: t.lastTimestamp,
      });
      positionBook[sym].qty -= t.totalQty;
      positionBook[sym].totalCost -= avgEntry * t.totalQty;
      if (positionBook[sym].qty < 0.001) {
        positionBook[sym] = { qty: 0, totalCost: 0 };
      }
    }
  }

  // 1. Win rate
  const wins = closedTrades.filter(t => t.realizedPnl > 0);
  const losses = closedTrades.filter(t => t.realizedPnl <= 0);
  const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;

  // 2. Average win vs average loss
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.realizedPnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.realizedPnl, 0) / losses.length) : 0;

  // 3. Profit factor
  const grossWins = wins.reduce((s, t) => s + t.realizedPnl, 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + t.realizedPnl, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

  // 4. Sharpe ratio (from portfolio daily returns)
  let sharpeRatio = 0;
  if (portfolioHistory && portfolioHistory.equity && portfolioHistory.equity.length > 2) {
    const equities = portfolioHistory.equity.map(Number);
    const dailyReturns = equities.slice(1).map((e, i) => (e - equities[i]) / equities[i]);
    const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const stdDev = Math.sqrt(dailyReturns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / dailyReturns.length);
    // Annualize: sqrt(252) * mean / std
    sharpeRatio = stdDev > 0 ? (Math.sqrt(252) * avgReturn) / stdDev : 0;
  }

  // 5. Max drawdown
  let maxDrawdown = 0;
  let peak = 0;
  let drawdownData = [];
  if (portfolioHistory && portfolioHistory.equity && portfolioHistory.equity.length > 0) {
    const equities = portfolioHistory.equity.map(Number);
    peak = equities[0];
    for (let i = 0; i < equities.length; i++) {
      if (equities[i] > peak) peak = equities[i];
      const dd = peak > 0 ? ((peak - equities[i]) / peak) * 100 : 0;
      drawdownData.push({
        date: portfolioHistory.timestamp ? new Date(portfolioHistory.timestamp[i] * 1000).toISOString().split('T')[0] : `Day ${i + 1}`,
        equity: equities[i],
        peak,
        drawdown: dd,
      });
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
  }

  // 6. Best/worst trades
  const bestTrade = closedTrades.length > 0 ? closedTrades.reduce((best, t) => t.realizedPnl > best.realizedPnl ? t : best, closedTrades[0]) : null;
  const worstTrade = closedTrades.length > 0 ? closedTrades.reduce((worst, t) => t.realizedPnl < worst.realizedPnl ? t : worst, closedTrades[0]) : null;

  // 7. Weekly P&L breakdown from portfolio history
  let weeklyPnl = [];
  if (portfolioHistory && portfolioHistory.equity && portfolioHistory.equity.length > 1) {
    const equities = portfolioHistory.equity.map(Number);
    const timestamps = portfolioHistory.timestamp || [];
    // Group by week
    let weekStart = equities[0];
    let weekStartIdx = 0;
    let currentWeek = timestamps.length > 0 ? getWeekNumber(new Date(timestamps[0] * 1000)) : 1;
    for (let i = 1; i < equities.length; i++) {
      const week = timestamps.length > 0 ? getWeekNumber(new Date(timestamps[i] * 1000)) : i;
      if (week !== currentWeek || i === equities.length - 1) {
        const endIdx = i === equities.length - 1 ? i : i - 1;
        weeklyPnl.push({
          week: currentWeek,
          startEquity: weekStart,
          endEquity: equities[endIdx],
          pnl: equities[endIdx] - weekStart,
          pnlPct: weekStart > 0 ? ((equities[endIdx] - weekStart) / weekStart) * 100 : 0,
          dateRange: timestamps.length > 0
            ? `${new Date(timestamps[weekStartIdx] * 1000).toLocaleDateString()} - ${new Date(timestamps[endIdx] * 1000).toLocaleDateString()}`
            : `Week ${currentWeek}`,
        });
        weekStart = equities[endIdx];
        weekStartIdx = endIdx;
        currentWeek = week;
      }
    }
  }

  // Also monthly P&L
  let monthlyPnl = [];
  if (portfolioHistory && portfolioHistory.equity && portfolioHistory.equity.length > 1) {
    const equities = portfolioHistory.equity.map(Number);
    const timestamps = portfolioHistory.timestamp || [];
    let monthStart = equities[0];
    let monthStartIdx = 0;
    let currentMonth = timestamps.length > 0 ? new Date(timestamps[0] * 1000).getMonth() : 0;
    for (let i = 1; i < equities.length; i++) {
      const month = timestamps.length > 0 ? new Date(timestamps[i] * 1000).getMonth() : i;
      if (month !== currentMonth || i === equities.length - 1) {
        const endIdx = i === equities.length - 1 ? i : i - 1;
        monthlyPnl.push({
          month: new Date(timestamps[endIdx] * 1000).toLocaleString('default', { month: 'short', year: '2-digit' }),
          startEquity: monthStart,
          endEquity: equities[endIdx],
          pnl: equities[endIdx] - monthStart,
          pnlPct: monthStart > 0 ? ((equities[endIdx] - monthStart) / monthStart) * 100 : 0,
        });
        monthStart = equities[endIdx];
        monthStartIdx = endIdx;
        currentMonth = month;
      }
    }
  }

  return {
    totalTrades: closedTrades.length,
    winRate: Math.round(winRate * 10) / 10,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    profitFactor: profitFactor === Infinity ? null : Math.round(profitFactor * 100) / 100,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    grossWins: Math.round(grossWins * 100) / 100,
    grossLosses: Math.round(grossLosses * 100) / 100,
    bestTrade: bestTrade,
    worstTrade: worstTrade,
    drawdownData: drawdownData.slice(-90), // last 90 days
    closedTrades,
    weeklyPnl,
    monthlyPnl,
  };
}

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

export default async (req) => {
  try {
    // Fetch all data in parallel
    const [activities, portfolioHistory] = await Promise.allSettled([
      getActivities(),
      getPortfolioHistory('3M', '1D'),
    ]);

    const actData = activities.status === 'fulfilled' ? (activities.value || []) : [];
    const histData = portfolioHistory.status === 'fulfilled' ? portfolioHistory.value : null;

    // Aggregate trades from fill activities
    const trades = aggregateTrades(actData);

    // Compute performance metrics
    const metrics = computeMetrics(trades, [], histData);

    return new Response(JSON.stringify({
      timestamp: new Date().toISOString(),
      ...metrics,
    }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

# No path config - routed via netlify.toml redirects;