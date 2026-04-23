import { useState, useEffect } from 'react';
import { fetchAnalytics } from '../api';

function MetricCard({ title, value, subtitle, color = 'white', icon }) {
  const colorMap = {
    green: 'text-[var(--accent-green)]',
    red: 'text-[var(--accent-red)]',
    yellow: 'text-[var(--accent-amber)]',
    blue: 'text-[var(--accent-blue)]',
    white: 'text-[var(--text-primary)]',
  };
  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
      <div className="flex items-center gap-2 mb-1">
        {icon && <span className="text-lg">{icon}</span>}
        <p className="text-xs text-[var(--text-muted)]">{title}</p>
      </div>
      <p className={`text-xl font-bold ${colorMap[color] || colorMap.white}`}>{value}</p>
      {subtitle && <p className="text-xs text-[var(--text-muted)] mt-1">{subtitle}</p>}
    </div>
  );
}

function DrawdownChart({ data }) {
  if (!data || data.length === 0) {
    return <p className="text-[var(--text-muted)] text-sm text-center py-4">No drawdown data available</p>;
  }
  const maxDD = Math.max(...data.map(d => d.drawdown));
  const maxEquity = Math.max(...data.map(d => d.peak));
  const chartH = 140;
  const barW = Math.max(2, Math.min(6, 600 / data.length));

  return (
    <div className="relative" style={{ height: chartH + 30 }}>
      <svg width="100%" height={chartH + 30} viewBox={`0 0 ${data.length * barW + 40} ${chartH + 30}`} preserveAspectRatio="none">
        {/* Grid lines */}
        {[0, 25, 50, 75, 100].map(pct => {
          const y = (pct / 100) * chartH;
          return <line key={pct} x1="40" y1={y} x2={data.length * barW + 40} y2={y} stroke="var(--border)" strokeWidth="0.5" />;
        })}
        {/* Drawdown area fill */}
        <path
          d={data.map((d, i) => {
            const x = 40 + i * barW;
            const y = (d.drawdown / Math.max(maxDD, 1)) * chartH;
            return `${i === 0 ? 'M' : 'L'}${x},${y}`;
          }).join(' ')}
          fill="none"
          stroke="var(--accent-red)"
          strokeWidth="1.5"
        />
        {/* Equity line (scaled) */}
        <path
          d={data.map((d, i) => {
            const x = 40 + i * barW;
            const y = chartH - ((d.equity / maxEquity) * chartH * 0.8) - chartH * 0.1;
            return `${i === 0 ? 'M' : 'L'}${x},${Math.max(0, y)}`;
          }).join(' ')}
          fill="none"
          stroke="var(--accent-blue)"
          strokeWidth="1"
          opacity="0.5"
        />
      </svg>
      <div className="flex justify-between text-[10px] text-[var(--text-muted)] px-12">
        <span>0%</span><span>{(maxDD / 2).toFixed(1)}%</span><span>{maxDD.toFixed(1)}%</span>
      </div>
    </div>
  );
}

function PnLHeatmap({ data }) {
  if (!data || data.length === 0) {
    return <p className="text-[var(--text-muted)] text-sm text-center py-4">No P&L data available</p>;
  }

  const maxAbs = Math.max(...data.map(d => Math.abs(d.pnlPct)), 1);

  return (
    <div className="space-y-1">
      {data.map((d, i) => {
        const intensity = maxAbs > 0 ? Math.abs(d.pnlPct) / maxAbs : 0;
        const isPositive = d.pnlPct >= 0;
        const bgColor = isPositive
          ? `rgba(0, 200, 83, ${0.1 + intensity * 0.4})`
          : `rgba(255, 23, 68, ${0.1 + intensity * 0.4})`;
        return (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-24 text-[var(--text-muted)] shrink-0">{d.dateRange || d.week || d.month}</span>
            <div className="flex-1 rounded px-2 py-1" style={{ backgroundColor: bgColor }}>
              <span className={isPositive ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}>
                {isPositive ? '+' : ''}{d.pnlPct.toFixed(2)}%
              </span>
            </div>
            <span className={`w-20 text-right font-mono ${isPositive ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
              {isPositive ? '+' : ''}{d.pnl < 0 ? '-' : ''}${Math.abs(d.pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TradeTable({ trades }) {
  if (!trades || trades.length === 0) {
    return <p className="text-[var(--text-muted)] text-sm text-center py-4">No closed trades yet</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-[var(--bg-secondary)]">
          <tr>
            <th className="px-3 py-2 text-xs font-medium text-[var(--text-muted)] text-left">Date</th>
            <th className="px-3 py-2 text-xs font-medium text-[var(--text-muted)] text-left">Symbol</th>
            <th className="px-3 py-2 text-xs font-medium text-[var(--text-muted)] text-right">Entry</th>
            <th className="px-3 py-2 text-xs font-medium text-[var(--text-muted)] text-right">Exit</th>
            <th className="px-3 py-2 text-xs font-medium text-[var(--text-muted)] text-right">Qty</th>
            <th className="px-3 py-2 text-xs font-medium text-[var(--text-muted)] text-right">P&L</th>
          </tr>
        </thead>
        <tbody>
          {trades.slice().reverse().slice(0, 20).map((t, i) => (
            <tr key={i} className="border-t border-[var(--border)] hover:bg-[var(--bg-secondary)]/50">
              <td className="px-3 py-2 text-[var(--text-muted)]">{new Date(t.timestamp).toLocaleDateString()}</td>
              <td className="px-3 py-2 text-[var(--text-primary)] font-medium">{t.symbol}</td>
              <td className="px-3 py-2 text-right font-mono text-[var(--text-primary)]">${t.entryPrice?.toFixed(2)}</td>
              <td className="px-3 py-2 text-right font-mono text-[var(--text-primary)]">${t.exitPrice?.toFixed(2)}</td>
              <td className="px-3 py-2 text-right font-mono text-[var(--text-primary)]">{t.qty?.toFixed(6)}</td>
              <td className={`px-3 py-2 text-right font-mono ${t.realizedPnl >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                {t.realizedPnl >= 0 ? '+' : ''}${Math.abs(t.realizedPnl).toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Analytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeView, setActiveView] = useState('overview');

  useEffect(() => {
    loadAnalytics();
  }, []);

  const loadAnalytics = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAnalytics();
      if (res.error) throw new Error(res.error);
      setData(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-8 text-center">
        <div className="animate-pulse text-2xl mb-3">📊</div>
        <p className="text-[var(--text-muted)]">Loading analytics...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/30 text-[var(--accent-red)] px-4 py-3 rounded-lg">
        ⚠️ Failed to load analytics: {error}
        <button onClick={loadAnalytics} className="ml-3 underline">Retry</button>
      </div>
    );
  }

  if (!data) return null;

  const {
    totalTrades = 0,
    winRate = 0,
    avgWin = 0,
    avgLoss = 0,
    profitFactor = 0,
    sharpeRatio = 0,
    maxDrawdown = 0,
    grossWins = 0,
    grossLosses = 0,
    bestTrade = null,
    worstTrade = null,
    drawdownData = [],
    closedTrades = [],
    weeklyPnl = [],
    monthlyPnl = [],
  } = data;

  return (
    <div className="space-y-6">
      {/* Summary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard
          icon="🎯"
          title="Win Rate"
          value={`${winRate}%`}
          subtitle={`${totalTrades} total trades`}
          color={winRate >= 50 ? 'green' : winRate >= 30 ? 'yellow' : 'red'}
        />
        <MetricCard
          icon="📐"
          title="Profit Factor"
          value={profitFactor === null ? '∞' : profitFactor?.toFixed(2) || '0.00'}
          subtitle={profitFactor > 1.5 ? 'Strong edge' : profitFactor > 1 ? 'Slight edge' : 'No edge'}
          color={profitFactor === null || profitFactor > 1.5 ? 'green' : profitFactor > 1 ? 'yellow' : 'red'}
        />
        <MetricCard
          icon="🏆"
          title="Avg Win"
          value={`+$${avgWin.toFixed(2)}`}
          color="green"
        />
        <MetricCard
          icon="📉"
          title="Avg Loss"
          value={`-$${avgLoss.toFixed(2)}`}
          color="red"
        />
        <MetricCard
          icon="📊"
          title="Sharpe Ratio"
          value={sharpeRatio?.toFixed(2) || '0.00'}
          subtitle={sharpeRatio > 1 ? 'Good' : sharpeRatio > 0 ? 'Okay' : 'Poor'}
          color={sharpeRatio > 1 ? 'green' : sharpeRatio > 0 ? 'yellow' : 'red'}
        />
        <MetricCard
          icon="🔻"
          title="Max Drawdown"
          value={`${maxDrawdown.toFixed(1)}%`}
          subtitle="Peak-to-trough"
          color={maxDrawdown < 10 ? 'green' : maxDrawdown < 20 ? 'yellow' : 'red'}
        />
      </div>

      {/* Gross P&L Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[var(--accent-green)]/5 border border-[var(--accent-green)]/20 rounded-xl p-4">
          <p className="text-xs text-[var(--accent-green)] mb-1">Gross Wins</p>
          <p className="text-2xl font-bold text-[var(--accent-green)]">+${grossWins.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
        </div>
        <div className="bg-[var(--accent-red)]/5 border border-[var(--accent-red)]/20 rounded-xl p-4">
          <p className="text-xs text-[var(--accent-red)] mb-1">Gross Losses</p>
          <p className="text-2xl font-bold text-[var(--accent-red)]">-${grossLosses.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
        </div>
      </div>

      {/* Best / Worst Trades */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {bestTrade && (
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--accent-green)]/30 p-4">
            <p className="text-xs text-[var(--text-muted)] mb-2">🏆 Best Trade</p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[var(--text-primary)] font-bold">{bestTrade.symbol}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {new Date(bestTrade.timestamp).toLocaleDateString()} · {bestTrade.qty?.toFixed(4)} qty
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-[var(--accent-green)]">+${bestTrade.realizedPnl.toFixed(2)}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  ${bestTrade.entryPrice?.toFixed(2)} → ${bestTrade.exitPrice?.toFixed(2)}
                </p>
              </div>
            </div>
          </div>
        )}
        {worstTrade && (
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--accent-red)]/30 p-4">
            <p className="text-xs text-[var(--text-muted)] mb-2">🔻 Worst Trade</p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[var(--text-primary)] font-bold">{worstTrade.symbol}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {new Date(worstTrade.timestamp).toLocaleDateString()} · {worstTrade.qty?.toFixed(4)} qty
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-[var(--accent-red)]">${worstTrade.realizedPnl.toFixed(2)}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  ${worstTrade.entryPrice?.toFixed(2)} → ${worstTrade.exitPrice?.toFixed(2)}
                </p>
              </div>
            </div>
          </div>
        )}
        {!bestTrade && !worstTrade && (
          <div className="col-span-2 bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 text-center text-[var(--text-muted)]">
            No completed trades yet. Start trading to see your best and worst trades.
          </div>
        )}
      </div>

      {/* View Tabs */}
      <div className="flex gap-2">
        {[
          { id: 'overview', label: '📊 Overview' },
          { id: 'drawdown', label: '🔻 Drawdown' },
          { id: 'weekly', label: '📅 Weekly P&L' },
          { id: 'monthly', label: '📆 Monthly P&L' },
          { id: 'trades', label: '📋 Trade Log' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveView(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeView === tab.id
                ? 'bg-[var(--accent-blue)] text-[var(--text-primary)]'
                : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeView === 'overview' && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">Performance Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-[var(--text-muted)] text-xs">Total Trades</p>
              <p className="font-bold text-[var(--text-primary)]">{totalTrades}</p>
            </div>
            <div>
              <p className="text-[var(--text-muted)] text-xs">Winning / Losing</p>
              <p className="font-bold text-[var(--text-primary)]">
                <span className="text-[var(--accent-green)]">{closedTrades.filter(t => t.realizedPnl > 0).length}</span>
                {' / '}
                <span className="text-[var(--accent-red)]">{closedTrades.filter(t => t.realizedPnl <= 0).length}</span>
              </p>
            </div>
            <div>
              <p className="text-[var(--text-muted)] text-xs">Avg Win / Loss Ratio</p>
              <p className="font-bold text-[var(--text-primary)]">
                {avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : avgWin > 0 ? '∞' : '0'}:1
              </p>
            </div>
            <div>
              <p className="text-[var(--text-muted)] text-xs">Net P&L</p>
              <p className={`font-bold ${(grossWins - grossLosses) >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                ${(grossWins - grossLosses).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>
          {drawdownData.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-[var(--text-muted)] mb-2">Max Drawdown Chart (recent)</p>
              <DrawdownChart data={drawdownData.slice(-60)} />
              <div className="flex items-center gap-4 text-[10px] text-[var(--text-muted)] mt-1">
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[var(--accent-red)]"></span> Drawdown</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[var(--accent-blue)] opacity-50"></span> Equity</span>
              </div>
            </div>
          )}
        </div>
      )}

      {activeView === 'drawdown' && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">Max Drawdown Chart</h3>
          <DrawdownChart data={drawdownData} />
          <div className="flex items-center gap-4 text-[10px] text-[var(--text-muted)] mt-1">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[var(--accent-red)]"></span> Drawdown %</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-[var(--accent-blue)] opacity-50"></span> Equity</span>
          </div>
        </div>
      )}

      {activeView === 'weekly' && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">Weekly P&L Heatmap</h3>
          <PnLHeatmap data={weeklyPnl} />
        </div>
      )}

      {activeView === 'monthly' && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">Monthly P&L Heatmap</h3>
          <PnLHeatmap data={monthlyPnl} />
        </div>
      )}

      {activeView === 'trades' && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">Closed Trade Log</h3>
          <TradeTable trades={closedTrades} />
        </div>
      )}

      {/* Refresh */}
      <div className="text-center">
        <button
          onClick={loadAnalytics}
          className="px-4 py-2 bg-[var(--bg-secondary)] hover:bg-[var(--border)] rounded-lg text-sm text-[var(--text-muted)] transition-colors border border-[var(--border)]"
        >
          ↻ Refresh Analytics
        </button>
      </div>
    </div>
  );
}