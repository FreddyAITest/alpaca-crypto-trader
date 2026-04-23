import { useState, useEffect } from 'react';
import { fetchAccount, fetchActivities, fetchPortfolioHistory } from '../api';

// --- Calculation Helpers ---

function calcWinRate(trades) {
  if (trades.length === 0) return 0;
  const wins = trades.filter(t => t.pnl > 0).length;
  return (wins / trades.length) * 100;
}

function calcAvgWinLoss(trades) {
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;
  return { avgWin, avgLoss };
}

function calcProfitFactor(trades) {
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  if (grossLoss === 0) return grossWin > 0 ? Infinity : 0;
  return grossWin / grossLoss;
}

function calcSharpeapproximation(dailyReturns) {
  if (dailyReturns.length < 2) return 0;
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const stdDev = Math.sqrt(dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1));
  if (stdDev === 0) return 0;
  // Annualized: mean * sqrt(252) / stdDev
  return (mean * Math.sqrt(252)) / stdDev;
}

function calcMaxDrawdown(equityCurve) {
  if (equityCurve.length === 0) return { maxDrawdown: 0, peakIndex: 0, troughIndex: 0 };
  let peak = equityCurve[0];
  let maxDD = 0;
  let peakIdx = 0;
  let troughIdx = 0;
  let bestPeakIdx = 0;
  for (let i = 1; i < equityCurve.length; i++) {
    if (equityCurve[i] > peak) {
      peak = equityCurve[i];
      peakIdx = i;
    }
    const dd = (peak - equityCurve[i]) / peak;
    if (dd > maxDD) {
      maxDD = dd;
      troughIdx = i;
      bestPeakIdx = peakIdx;
    }
  }
  return { maxDrawdown: maxDD * 100, peakIndex: bestPeakIdx, troughIndex: troughIdx };
}

function calcPnLByPeriod(trades, period) {
  const map = {};
  for (const t of trades) {
    const d = new Date(t.closeTime);
    let key;
    if (period === 'daily') {
      key = d.toISOString().split('T')[0];
    } else if (period === 'weekly') {
      const startOfWeek = new Date(d);
      startOfWeek.setDate(d.getDate() - d.getDay());
      key = startOfWeek.toISOString().split('T')[0];
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    if (!map[key]) map[key] = 0;
    map[key] += t.pnl;
  }
  return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([date, pnl]) => ({ date, pnl }));
}

// Build trade list from activities (match buys with sells)
function buildTrades(activities) {
  if (!activities || activities.length === 0) return [];

  // Sort by time
  const sorted = [...activities].sort((a, b) =>
    new Date(a.timestamp || a.transaction_datetime) - new Date(b.timestamp || b.transaction_datetime)
  );

  // Track open positions per symbol
  const positions = {};
  const trades = [];

  for (const act of sorted) {
    const sym = act.symbol;
    const side = act.side;
    const qty = parseFloat(act.qty || 0);
    const price = parseFloat(act.price || 0);
    const time = act.timestamp || act.transaction_datetime;

    if (side === 'buy') {
      if (!positions[sym]) positions[sym] = { qty: 0, totalCost: 0 };
      positions[sym].qty += qty;
      positions[sym].totalCost += qty * price;
    } else if (side === 'sell') {
      if (positions[sym] && positions[sym].qty > 0) {
        const avgEntry = positions[sym].totalCost / positions[sym].qty;
        const closeQty = Math.min(qty, positions[sym].qty);
        const pnl = closeQty * (price - avgEntry);
        const pnlPct = ((price - avgEntry) / avgEntry) * 100;

        trades.push({
          symbol: sym,
          entryPrice: avgEntry,
          exitPrice: price,
          qty: closeQty,
          pnl,
          pnlPct,
          openTime: positions[sym].openTime || time,
          closeTime: time,
          side: 'long',
        });

        positions[sym].qty -= closeQty;
        positions[sym].totalCost -= closeQty * avgEntry;
        if (positions[sym].qty <= 0) {
          delete positions[sym];
        }
      }
    }
  }

  return trades;
}

// --- Component ---

export default function PerformanceAnalytics() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [trades, setTrades] = useState([]);
  const [equityCurve, setEquityCurve] = useState([]);
  const [dailyReturns, setDailyReturns] = useState([]);
  const [account, setAccount] = useState(null);
  const [periodView, setPeriodView] = useState('daily');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [accRes, actRes, histRes] = await Promise.allSettled([
          fetchAccount(),
          fetchActivities(),
          fetchPortfolioHistory('1M', '1D'),
        ]);

        if (cancelled) return;

        const acc = accRes.status === 'fulfilled' ? accRes.value : null;
        setAccount(acc);

        const activities = actRes.status === 'fulfilled' ? actRes.value : [];
        const tradeList = buildTrades(Array.isArray(activities) ? activities : []);
        setTrades(tradeList);

        const hist = histRes.status === 'fulfilled' ? histRes.value : null;
        if (hist && hist.equity && hist.equity.length > 0) {
          const curve = hist.equity.map(Number);
          setEquityCurve(curve);

          // Daily returns
          const returns = [];
          for (let i = 1; i < curve.length; i++) {
            if (curve[i - 1] !== 0) {
              returns.push((curve[i] - curve[i - 1]) / curve[i - 1]);
            }
          }
          setDailyReturns(returns);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-[var(--text-muted)]">
        <span className="animate-spin mr-2">⏳</span> Loading analytics...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/30 text-[var(--accent-red)] px-4 py-3 rounded-lg text-sm">
        ⚠️ {error}
      </div>
    );
  }

  // Compute metrics
  const winRate = calcWinRate(trades);
  const { avgWin, avgLoss } = calcAvgWinLoss(trades);
  const profitFactor = calcProfitFactor(trades);
  const sharpe = calcSharpeapproximation(dailyReturns);
  const maxDD = calcMaxDrawdown(equityCurve);
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const bestTrade = trades.length > 0 ? trades.reduce((a, b) => a.pnl > b.pnl ? a : b) : null;
  const worstTrade = trades.length > 0 ? trades.reduce((a, b) => a.pnl < b.pnl ? a : b) : null;
  const pnlByPeriod = calcPnLByPeriod(trades, periodView);

  // Simple mini chart for equity curve
  const minEquity = equityCurve.length > 0 ? Math.min(...equityCurve) : 0;
  const maxEquity = equityCurve.length > 0 ? Math.max(...equityCurve) : 0;
  const rangeEquity = maxEquity - minEquity || 1;

  return (
    <div className="space-y-6">
      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard title="Total Trades" value={trades.length} icon="📊" />
        <MetricCard title="Win Rate" value={`${winRate.toFixed(1)}%`} valueClass={winRate >= 50 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'} icon="🎯" />
        <MetricCard title="Profit Factor" value={profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)} valueClass={profitFactor >= 1.5 ? 'text-[var(--accent-green)]' : profitFactor >= 1 ? 'text-[var(--accent-amber)]' : 'text-[var(--accent-red)]'} icon="⚖️" />
        <MetricCard title="Sharpe Ratio" value={sharpe.toFixed(2)} valueClass={sharpe >= 1 ? 'text-[var(--accent-green)]' : sharpe >= 0 ? 'text-[var(--accent-amber)]' : 'text-[var(--accent-red)]'} icon="📐" />
        <MetricCard title="Max Drawdown" value={`-${maxDD.maxDrawdown.toFixed(1)}%`} valueClass="text-[var(--accent-red)]" icon="📉" />
        <MetricCard title="Net P&L" value={`$${totalPnl.toFixed(2)}`} valueClass={totalPnl >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'} icon="💰" />
      </div>

      {/* Equity Curve */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
        <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">Equity Curve (30d)</h3>
        {equityCurve.length > 1 ? (
          <div className="relative h-32">
            <svg viewBox={`0 0 ${equityCurve.length} 100`} className="w-full h-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* Fill area */}
              <path
                d={`M0,${100 - ((equityCurve[0] - minEquity) / rangeEquity) * 100} ${equityCurve.map((v, i) => `L${i},${100 - ((v - minEquity) / rangeEquity) * 100}`).join(' ')} L${equityCurve.length - 1},100 L0,100 Z`}
                fill="url(#equityGrad)"
              />
              {/* Line */}
              <polyline
                points={equityCurve.map((v, i) => `${i},${100 - ((v - minEquity) / rangeEquity) * 100}`).join(' ')}
                fill="none"
                stroke="var(--accent-blue)"
                strokeWidth="2"
              />
            </svg>
            <div className="absolute bottom-1 right-2 text-xs text-[var(--text-muted)]">
              ${maxEquity.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
            <div className="absolute top-1 right-2 text-xs text-[var(--text-muted)]">
              ${minEquity.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">
            No equity history available
          </div>
        )}
      </div>

      {/* Win/Loss Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">Win/Loss Breakdown</h3>
          {trades.length > 0 ? (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-[var(--accent-green)]">Avg Win</span>
                <span className="text-sm font-bold text-[var(--accent-green)]">+${avgWin.toFixed(2)}</span>
              </div>
              <div className="w-full bg-[var(--bg-secondary)] rounded-full h-2">
                <div className="bg-[var(--accent-green)] h-2 rounded-full" style={{ width: `${avgWin / (avgWin + avgLoss || 1) * 100}%` }} />
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-[var(--accent-red)]">Avg Loss</span>
                <span className="text-sm font-bold text-[var(--accent-red)]">-${avgLoss.toFixed(2)}</span>
              </div>
              <div className="w-full bg-[var(--bg-secondary)] rounded-full h-2">
                <div className="bg-[var(--accent-red)] h-2 rounded-full" style={{ width: `${avgLoss / (avgWin + avgLoss || 1) * 100}%` }} />
              </div>
              <div className="pt-2 border-t border-[var(--border)] flex justify-between">
                <span className="text-sm text-[var(--text-muted)]">Win/Loss Ratio</span>
                <span className="text-sm font-bold text-[var(--text-primary)]">{avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : '∞'}:1</span>
              </div>
            </div>
          ) : (
            <div className="text-[var(--text-muted)] text-sm text-center py-4">No closed trades yet</div>
          )}
        </div>

        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">Best & Worst Trades</h3>
          {trades.length > 0 ? (
            <div className="space-y-3">
              {bestTrade && (
                <div className="flex justify-between items-center p-2 bg-[var(--accent-green)]/5 rounded-lg border border-[var(--accent-green)]/20">
                  <div>
                    <span className="text-xs text-[var(--accent-green)]">🏆 Best</span>
                    <div className="text-sm text-[var(--text-primary)] font-medium">{bestTrade.symbol}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-[var(--accent-green)]">+${bestTrade.pnl.toFixed(2)}</div>
                    <div className="text-xs text-[var(--accent-green)]">+{bestTrade.pnlPct.toFixed(1)}%</div>
                  </div>
                </div>
              )}
              {worstTrade && (
                <div className="flex justify-between items-center p-2 bg-[var(--accent-red)]/5 rounded-lg border border-[var(--accent-red)]/20">
                  <div>
                    <span className="text-xs text-[var(--accent-red)]">💀 Worst</span>
                    <div className="text-sm text-[var(--text-primary)] font-medium">{worstTrade.symbol}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-[var(--accent-red)]">${worstTrade.pnl.toFixed(2)}</div>
                    <div className="text-xs text-[var(--accent-red)]">{worstTrade.pnlPct.toFixed(1)}%</div>
                  </div>
                </div>
              )}
              <div className="pt-2 border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
                Win streak: {calcStreak(trades, 'win')} | Loss streak: {calcStreak(trades, 'loss')}
              </div>
            </div>
          ) : (
            <div className="text-[var(--text-muted)] text-sm text-center py-4">No closed trades yet</div>
          )}
        </div>
      </div>

      {/* P&L by Period Heatmap */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-[var(--text-muted)]">P&L by Period</h3>
          <div className="flex bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] overflow-hidden">
            {['daily', 'weekly', 'monthly'].map(p => (
              <button
                key={p}
                onClick={() => setPeriodView(p)}
                className={`px-3 py-1 text-xs font-medium transition-colors capitalize ${
                  periodView === p ? 'bg-[var(--accent-blue)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        {pnlByPeriod.length > 0 ? (
          <div className="space-y-1">
            {pnlByPeriod.slice(-14).map(({ date, pnl }) => (
              <div key={date} className="flex items-center gap-3">
                <span className="text-xs text-[var(--text-muted)] w-24 shrink-0">{date}</span>
                <div className="flex-1 h-5 bg-[var(--bg-secondary)] rounded overflow-hidden relative">
                  <div
                    className={`h-full rounded transition-all ${pnl >= 0 ? 'bg-[var(--accent-green)]/30' : 'bg-[var(--accent-red)]/30'}`}
                    style={{
                      width: `${Math.min(Math.abs(pnl) / (Math.max(...pnlByPeriod.map(p => Math.abs(p.pnl))) || 1) * 100, 100)}%`,
                    }}
                  />
                </div>
                <span className={`text-xs font-mono w-20 text-right ${pnl >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                  {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[var(--text-muted)] text-sm text-center py-4">No trade data for this period</div>
        )}
      </div>

      {/* Trade Log */}
      {trades.length > 0 && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">Trade History ({trades.length} trades)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[var(--text-muted)] border-b border-[var(--border)]">
                  <th className="text-left py-2 px-2">Symbol</th>
                  <th className="text-right py-2 px-2">Entry</th>
                  <th className="text-right py-2 px-2">Exit</th>
                  <th className="text-right py-2 px-2">Qty</th>
                  <th className="text-right py-2 px-2">P&L</th>
                  <th className="text-right py-2 px-2">P&L %</th>
                  <th className="text-right py-2 px-2">Closed</th>
                </tr>
              </thead>
              <tbody>
                {trades.slice(-20).reverse().map((t, i) => (
                  <tr key={i} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-secondary)]">
                    <td className="py-2 px-2 text-[var(--text-primary)] font-medium">{t.symbol}</td>
                    <td className="py-2 px-2 text-right text-[var(--text-muted)]">${t.entryPrice.toFixed(2)}</td>
                    <td className="py-2 px-2 text-right text-[var(--text-muted)]">${t.exitPrice.toFixed(2)}</td>
                    <td className="py-2 px-2 text-right text-[var(--text-muted)]">{t.qty.toFixed(6)}</td>
                    <td className={`py-2 px-2 text-right font-medium ${t.pnl >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                      {t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)}
                    </td>
                    <td className={`py-2 px-2 text-right ${t.pnlPct >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                      {t.pnlPct >= 0 ? '+' : ''}{t.pnlPct.toFixed(1)}%
                    </td>
                    <td className="py-2 px-2 text-right text-[var(--text-muted)] text-xs">
                      {new Date(t.closeTime).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper: Calculate current streak
function calcStreak(trades, type) {
  let max = 0, current = 0;
  for (const t of trades) {
    if ((type === 'win' && t.pnl > 0) || (type === 'loss' && t.pnl < 0)) {
      current++;
      max = Math.max(max, current);
    } else {
      current = 0;
    }
  }
  return max;
}

// Metric card sub-component
function MetricCard({ title, value, valueClass = 'text-[var(--text-primary)]', icon }) {
  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-3 hover:border-[var(--accent-blue)]/30 transition-colors">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-[var(--text-muted)] mb-1">{title}</p>
          <p className={`text-xl font-bold ${valueClass}`}>{value}</p>
        </div>
        <span className="text-lg">{icon}</span>
      </div>
    </div>
  );
}