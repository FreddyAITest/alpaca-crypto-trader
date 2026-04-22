import { useState, useEffect, useCallback } from 'react';
import { fetchActivities, fetchPortfolioHistory } from '../api';

function StatCard({ title, value, subtitle, color = 'text-white', icon }) {
  return (
    <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] p-4">
      <div className="flex items-center gap-2 mb-1">
        {icon && <span className="text-lg">{icon}</span>}
        <span className="text-xs text-[#8b8fa3]">{title}</span>
      </div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      {subtitle && <p className="text-xs text-[#8b8fa3] mt-0.5">{subtitle}</p>}
    </div>
  );
}

function formatMoney(val) {
  if (val === null || val === undefined) return '$—';
  const num = typeof val === 'string' ? parseFloat(val) : val;
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Analytics() {
  const [activities, setActivities] = useState([]);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState('1M');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [actRes, histRes] = await Promise.allSettled([
        fetchActivities(),
        fetchPortfolioHistory(period, '1D'),
      ]);
      if (actRes.status === 'fulfilled') setActivities(actRes.value);
      else setError('Failed to load activities: ' + actRes.reason?.message);
      if (histRes.status === 'fulfilled') setHistory(histRes.value);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { loadData(); }, [loadData]);

  // Compute analytics from filled orders
  const fills = Array.isArray(activities) ? activities.filter(a => a.activity_type === 'FILL' || a.side) : [];

  // Separate buys and sells
  const sellFills = fills.filter(f => f.side === 'sell');
  const buyFills = fills.filter(f => f.side === 'buy');

  // Compute P&L per closed position
  // Group by symbol, match buys to sells
  const symbols = [...new Set(fills.map(f => f.symbol))];
  const positionPnLs = [];
  const positionMap = {};

  fills.forEach(f => {
    if (!positionMap[f.symbol]) positionMap[f.symbol] = { buys: [], sells: [] };
    if (f.side === 'buy') {
      positionMap[f.symbol].buys.push({
        qty: parseFloat(f.qty || f.cumulative_quantity || 0),
        price: parseFloat(f.price || f.fill_price || 0),
        fee: parseFloat(f.commission || 0),
      });
    } else if (f.side === 'sell') {
      positionMap[f.symbol].sells.push({
        qty: parseFloat(f.qty || f.cumulative_quantity || 0),
        price: parseFloat(f.price || f.fill_price || 0),
        fee: parseFloat(f.commission || 0),
      });
    }
  });

  Object.entries(positionMap).forEach(([symbol, { buys, sells }]) => {
    const totalBuyCost = buys.reduce((s, b) => s + b.qty * b.price + b.fee, 0);
    const totalSellRevenue = sells.reduce((s, sl) => s + sl.qty * sl.price - sl.fee, 0);
    const totalBuyQty = buys.reduce((s, b) => s + b.qty, 0);
    const totalSellQty = sells.reduce((s, sl) => s + sl.qty, 0);

    if (totalBuyQty > 0 && totalSellQty > 0) {
      const avgBuyPrice = totalBuyCost / totalBuyQty;
      const avgSellPrice = totalSellRevenue / totalSellQty;
      const closedQty = Math.min(totalBuyQty, totalSellQty);
      const pnl = closedQty * (avgSellPrice - avgBuyPrice);
      positionPnLs.push({ symbol, pnl, avgBuyPrice, avgSellPrice, closedQty });
    }
  });

  const wins = positionPnLs.filter(p => p.pnl > 0);
  const losses = positionPnLs.filter(p => p.pnl <= 0);
  const winRate = positionPnLs.length > 0 ? (wins.length / positionPnLs.length * 100) : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, w) => s + w.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, l) => s + l.pnl, 0) / losses.length) : 0;
  const totalWins = wins.reduce((s, w) => s + w.pnl, 0);
  const totalLosses = Math.abs(losses.reduce((s, l) => s + l.pnl, 0));
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

  // Portfolio stats from history
  const equityValues = history?.equity || [];
  const dailyReturns = equityValues.length > 1
    ? equityValues.slice(1).map((v, i) => (v - equityValues[i]) / equityValues[i])
    : [];
  const avgDailyReturn = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
  const stdDailyReturn = dailyReturns.length > 1
    ? Math.sqrt(dailyReturns.reduce((s, r) => s + (r - avgDailyReturn) ** 2, 0) / (dailyReturns.length - 1))
    : 0;
  const sharpeRatio = stdDailyReturn > 0 ? (avgDailyReturn / stdDailyReturn) * Math.sqrt(252) : 0;

  // Max drawdown
  let peak = 0;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  equityValues.forEach(v => {
    if (v > peak) peak = v;
    const dd = peak - v;
    const ddPct = peak > 0 ? dd / peak : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
  });

  // Best/worst trade
  const bestTrade = positionPnLs.length > 0 ? positionPnLs.reduce((a, b) => a.pnl > b.pnl ? a : b) : null;
  const worstTrade = positionPnLs.length > 0 ? positionPnLs.reduce((a, b) => a.pnl < b.pnl ? a : b) : null;

  // Weekly P&L breakdown
  const weeklyPnL = [];
  if (equityValues.length > 7) {
    for (let i = 0; i < equityValues.length; i += 7) {
      const startVal = equityValues[i];
      const endVal = equityValues[Math.min(i + 6, equityValues.length - 1)];
      if (startVal > 0) {
        weeklyPnL.push({
          week: Math.floor(i / 7) + 1,
          pnl: endVal - startVal,
          pnlPct: ((endVal - startVal) / startVal * 100),
        });
      }
    }
  }

  const pnlColor = (val) => val >= 0 ? 'text-[#00c853]' : 'text-[#ff1744]';

  if (loading && activities.length === 0) {
    return (
      <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] p-8 text-center">
        <div className="animate-pulse text-3xl mb-3">📊</div>
        <p className="text-[#8b8fa3]">Loading analytics...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-[#8b8fa3]">Period:</span>
        {['1W', '1M', '3M'].map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              period === p ? 'bg-[#448aff] text-white' : 'bg-[#252836] text-[#8b8fa3] hover:text-white'
            }`}
          >
            {p}
          </button>
        ))}
        <button
          onClick={loadData}
          className="px-3 py-1.5 bg-[#252836] hover:bg-[#2d3148] rounded-lg text-sm transition-colors border border-[#2d3148]"
        >
          ↻ Refresh
        </button>
      </div>

      {error && (
        <div className="bg-[#ff1744]/10 border border-[#ff1744]/30 text-[#ff1744] px-4 py-2 rounded-lg text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          icon="🎯"
          title="Win Rate"
          value={positionPnLs.length > 0 ? `${winRate.toFixed(1)}%` : '—'}
          subtitle={`${wins.length}W / ${losses.length}L`}
          color={pnlColor(winRate - 50)}
        />
        <StatCard
          icon="📈"
          title="Profit Factor"
          value={profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)}
          subtitle={profitFactor >= 1.5 ? 'Good' : profitFactor >= 1 ? 'Marginal' : 'Poor'}
          color={pnlColor(profitFactor - 1)}
        />
        <StatCard
          icon="⚖️"
          title="Avg Win / Loss"
          value={avgLoss > 0 ? `${(avgWin / avgLoss).toFixed(2)}` : '—'}
          subtitle={`$${avgWin.toFixed(2)} / $${avgLoss.toFixed(2)}`}
          color={pnlColor(avgWin - avgLoss)}
        />
        <StatCard
          icon="📐"
          title="Sharpe Ratio"
          value={sharpeRatio.toFixed(2)}
          subtitle={`${dailyReturns.length} daily returns`}
          color={pnlColor(sharpeRatio)}
        />
        <StatCard
          icon="📉"
          title="Max Drawdown"
          value={formatMoney(maxDrawdown)}
          subtitle={`${(maxDrawdownPct * 100).toFixed(1)}%`}
          color="text-[#ff1744]"
        />
        <StatCard
          icon="🔄"
          title="Total Trades"
          value={fills.length}
          subtitle={`${symbols.length} symbols`}
        />
      </div>

      {/* Best/Worst Trade */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {bestTrade && (
          <div className="bg-[#00c853]/5 rounded-xl border border-[#00c853]/20 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">🏆</span>
              <span className="text-sm font-medium text-[#00c853]">Best Trade</span>
            </div>
            <p className="text-xl font-bold text-[#00c853]">{formatMoney(bestTrade.pnl)}</p>
            <p className="text-xs text-[#8b8fa3]">
              {bestTrade.symbol} · Bought @ {formatMoney(bestTrade.avgBuyPrice)} · Sold @ {formatMoney(bestTrade.avgSellPrice)} · Qty: {bestTrade.closedQty}
            </p>
          </div>
        )}
        {worstTrade && (
          <div className="bg-[#ff1744]/5 rounded-xl border border-[#ff1744]/20 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">💀</span>
              <span className="text-sm font-medium text-[#ff1744]">Worst Trade</span>
            </div>
            <p className="text-xl font-bold text-[#ff1744]">{formatMoney(worstTrade.pnl)}</p>
            <p className="text-xs text-[#8b8fa3]">
              {worstTrade.symbol} · Bought @ {formatMoney(worstTrade.avgBuyPrice)} · Sold @ {formatMoney(worstTrade.avgSellPrice)} · Qty: {worstTrade.closedQty}
            </p>
          </div>
        )}
      </div>

      {/* Position Breakdown */}
      {positionPnLs.length > 0 && (
        <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#2d3148]">
            <span className="text-sm font-medium text-[#8b8fa3]">📋 Position P&L Breakdown</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#252836]">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-[#8b8fa3]">Symbol</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-[#8b8fa3]">Qty</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-[#8b8fa3]">Avg Buy</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-[#8b8fa3]">Avg Sell</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-[#8b8fa3]">P&L</th>
                </tr>
              </thead>
              <tbody>
                {positionPnLs.sort((a, b) => b.pnl - a.pnl).map((p, i) => (
                  <tr key={p.symbol} className="border-t border-[#2d3148] hover:bg-[#252836]/50 transition-colors">
                    <td className="px-4 py-2 font-medium text-white">{p.symbol}</td>
                    <td className="px-4 py-2 text-right text-white font-mono">{p.closedQty}</td>
                    <td className="px-4 py-2 text-right text-[#8b8fa3] font-mono">{formatMoney(p.avgBuyPrice)}</td>
                    <td className="px-4 py-2 text-right text-[#8b8fa3] font-mono">{formatMoney(p.avgSellPrice)}</td>
                    <td className={`px-4 py-2 text-right font-mono font-bold ${pnlColor(p.pnl)}`}>
                      {p.pnl >= 0 ? '+' : ''}{formatMoney(p.pnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Weekly P&L Heatmap */}
      {weeklyPnL.length > 0 && (
        <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] p-4">
          <span className="text-sm font-medium text-[#8b8fa3] mb-3 block">📅 Weekly P&L Breakdown</span>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {weeklyPnL.map((w, i) => (
              <div
                key={i}
                className={`rounded-lg p-3 text-center border ${
                  w.pnl >= 0 ? 'bg-[#00c853]/10 border-[#00c853]/20' : 'bg-[#ff1744]/10 border-[#ff1744]/20'
                }`}
              >
                <p className="text-xs text-[#8b8fa3]">Week {w.week}</p>
                <p className={`text-sm font-bold ${pnlColor(w.pnl)}`}>
                  {w.pnl >= 0 ? '+' : ''}{formatMoney(w.pnl)}
                </p>
                <p className={`text-xs ${pnlColor(w.pnl)}`}>
                  {w.pnlPct >= 0 ? '+' : ''}{w.pnlPct.toFixed(2)}%
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Gross P&L Summary */}
      {(totalWins > 0 || totalLosses > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#00c853]/5 border border-[#00c853]/20 rounded-xl p-4 text-center">
            <p className="text-xs text-[#00c853]">Gross Profit</p>
            <p className="text-xl font-bold text-[#00c853]">{formatMoney(totalWins)}</p>
            <p className="text-xs text-[#8b8fa3]">{wins.length} winning trades</p>
          </div>
          <div className="bg-[#ff1744]/5 border border-[#ff1744]/20 rounded-xl p-4 text-center">
            <p className="text-xs text-[#ff1744]">Gross Loss</p>
            <p className="text-xl font-bold text-[#ff1744]">{formatMoney(totalLosses)}</p>
            <p className="text-xs text-[#8b8fa3]">{losses.length} losing trades</p>
          </div>
          <div className="bg-[#1a1d29] border border-[#2d3148] rounded-xl p-4 text-center">
            <p className="text-xs text-[#8b8fa3]">Net P&L</p>
            <p className={`text-xl font-bold ${pnlColor(totalWins - totalLosses)}`}>
              {formatMoney(totalWins - totalLosses)}
            </p>
            <p className="text-xs text-[#8b8fa3]">{positionPnLs.length} closed positions</p>
          </div>
        </div>
      )}

      {/* Empty State */}
      {fills.length === 0 && !loading && (
        <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] p-8 text-center">
          <div className="text-4xl mb-3">📊</div>
          <p className="text-[#8b8fa3]">No trade data yet. Start trading to see analytics.</p>
          <p className="text-xs text-[#8b8fa3] mt-1">Your performance metrics will appear here once you have closed positions.</p>
        </div>
      )}
    </div>
  );
}