import { useState, useEffect } from 'react';
import { fetchLearningStatus } from '../api';

export default function LearningDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const status = await fetchLearningStatus();
      setData(status);
    } catch (e) {
      setData({ error: e.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-6 text-center">
        <div className="animate-pulse text-[var(--text-muted)]">Loading learning data...</div>
      </div>
    );
  }

  if (!data || data.error) {
    return (
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-4 text-center">
        <p className="text-sm text-[var(--text-muted)]">
          {data?.error || 'Learning system not yet initialized. It will populate as trades execute.'}
        </p>
      </div>
    );
  }

  const regimeLabel = {
    trending_up: { icon: '📈', color: 'text-[var(--accent-green)]' },
    trending_down: { icon: '📉', color: 'text-[var(--accent-red)]' },
    ranging: { icon: '↔️', color: 'text-[var(--accent-amber)]' },
    volatile: { icon: '🌊', color: 'text-[var(--accent-amber)]' },
    transitional: { icon: '🔄', color: 'text-[var(--text-muted)]' },
    unknown: { icon: '❓', color: 'text-[var(--text-muted)]' },
  };

  const r = regimeLabel[data.currentRegime] || regimeLabel.unknown;

  const strategyNames = {
    momentum: 'Momentum',
    scalp: 'Scalp',
    'mean-reversion': 'Mean Rev.',
    'stock-momentum': 'Stock Mom.',
  };

  return (
    <div className="space-y-4">
      {/* Market Regime & Global Stats */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-4">
        <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">🧠 Learning System (DEF-13)</h3>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-3">
          <div className="bg-[var(--bg-deep)] rounded-lg p-2">
            <p className="text-[var(--text-muted)] text-xs">Market Regime</p>
            <p className={`font-bold ${r.color}`}>{r.icon} {data.currentRegime?.replace('_', ' ')}</p>
          </div>
          <div className="bg-[var(--bg-deep)] rounded-lg p-2">
            <p className="text-[var(--text-muted)] text-xs">Total Trades</p>
            <p className="font-bold text-[var(--text-primary)]">{data.totalTrades}</p>
          </div>
          <div className="bg-[var(--bg-deep)] rounded-lg p-2">
            <p className="text-[var(--text-muted)] text-xs">Avg Reward</p>
            <p className={`font-bold ${(data.averageReward || 0) >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
              {data.averageReward?.toFixed(3) || '0.000'}
            </p>
          </div>
          <div className="bg-[var(--bg-deep)] rounded-lg p-2">
            <p className="text-[var(--text-muted)] text-xs">Exploration</p>
            <p className="font-bold text-[var(--accent-blue)]">{((data.explorationRate || 0) * 100).toFixed(0)}%</p>
          </div>
        </div>
      </div>

      {/* Strategy Confidence */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-4">
        <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">📊 Strategy Confidence</h3>
        <div className="space-y-2">
          {Object.entries(data.strategies || {}).map(([name, stats]) => (
            <div key={name} className="flex items-center gap-3">
              <span className="text-xs text-[var(--text-muted)] w-24 truncate">
                {strategyNames[name] || name}
              </span>
              <div className="flex-1 bg-[var(--bg-deep)] rounded-full h-3 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    (stats.confidence || 0) >= 0.6 ? 'bg-[var(--accent-green)]'
                    : (stats.confidence || 0) >= 0.4 ? 'bg-[var(--accent-amber)]'
                    : 'bg-[var(--accent-red)]'
                  }`}
                  style={{ width: `${(stats.confidence || 0) * 100}%` }}
                />
              </div>
              <span className="text-xs text-[var(--text-primary)] w-10 text-right">
                {stats.trades > 0 ? `${(stats.winRate * 100).toFixed(0)}%` : '—'}
              </span>
              <span className="text-xs text-[var(--text-muted)] w-12 text-right">
                {stats.trades > 0 ? `${stats.trades}t` : 'new'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Top Symbols & Blacklisted */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-4">
          <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">⭐ Top Symbols</h3>
          {data.topSymbols && data.topSymbols.length > 0 ? (
            <div className="space-y-1.5">
              {data.topSymbols.slice(0, 5).map(s => (
                <div key={s.symbol} className="flex justify-between text-xs">
                  <span className="text-[var(--text-primary)]">{s.symbol}</span>
                  <span className="text-[var(--text-muted)]">
                    {s.trades}t · WR {(s.winRate * 100).toFixed(0)}% · R {s.averageReward.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">Collecting data...</p>
          )}
        </div>

        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-4">
          <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">🚫 Blacklisted</h3>
          {data.blacklistedCount > 0 ? (
            <div className="space-y-1.5">
              {data.blacklisted.slice(0, 5).map(b => (
                <div key={b.symbol} className="flex justify-between text-xs">
                  <span className="text-[var(--accent-red)]">{b.symbol}</span>
                  <span className="text-[var(--text-muted)] truncate ml-2">{b.reason}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">None — all symbols eligible</p>
          )}
        </div>
      </div>

      {/* Adaptive Parameters */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-4">
        <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">⚙️ Adaptive Parameters</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          {Object.entries(data.adaptiveParams || {}).map(([key, value]) => (
            <div key={key} className="bg-[var(--bg-deep)] rounded p-2 flex justify-between">
              <span className="text-[var(--text-muted)]">{key}:</span>
              <span className="text-[var(--text-primary)] font-mono">
                {typeof value === 'number' ? (value % 1 === 0 ? value : value.toFixed(2)) : value}
              </span>
            </div>
          ))}
        </div>
        {data.lastAdaptation && (
          <p className="text-xs text-[var(--text-muted)] mt-2">
            Last adaptation: {new Date(data.lastAdaptation).toLocaleTimeString()} · Gen {data.adaptationGeneration}
          </p>
        )}
      </div>
    </div>
  );
}
