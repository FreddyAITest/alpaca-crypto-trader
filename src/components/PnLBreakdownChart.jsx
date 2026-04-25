import { useState, useEffect, useCallback } from 'react';
import { fetchPortfolioHistory, fetchActivities } from '../api';

export default function PnLBreakdownChart() {
  const [history, setHistory] = useState(null);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [hist, act] = await Promise.allSettled([
        fetchPortfolioHistory('1M', '1D'),
        fetchActivities(),
      ]);
      if (hist.status === 'fulfilled') setHistory(hist.value);
      if (act.status === 'fulfilled') setActivities(Array.isArray(act.value) ? act.value : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const formatMoney = (val) => {
    if (val === null || val === undefined) return '$—';
    const num = typeof val === 'string' ? parseFloat(val) : val;
    return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Compute daily P&L from portfolio history
  // Skip leading zero-equity entries (days before account was funded)
  const dailyPnL = [];
  if (history?.timestamp && history?.equity) {
    const equities = history.equity.map(v => parseFloat(v));
    const timestamps = history.timestamp;
    let startIdx = 0;
    while (startIdx < equities.length && equities[startIdx] === 0) {
      startIdx++;
    }
    // Need at least 2 valid data points for day-over-day P&L
    for (let i = Math.max(startIdx + 1, 1); i < timestamps.length; i++) {
      const prev = parseFloat(equities[i - 1]);
      const curr = parseFloat(equities[i]);
      // Skip transitions from 0 to non-zero (account funding day)
      if (prev === 0) continue;
      const pnl = curr - prev;
      const date = new Date(timestamps[i] * 1000);
      dailyPnL.push({
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        pnl,
        pnlPct: prev > 0 ? (pnl / prev) * 100 : 0,
        equity: curr,
      });
    }
  }

  // Summary stats
  const totalPnL = dailyPnL.reduce((sum, d) => sum + d.pnl, 0);
  const winningDays = dailyPnL.filter(d => d.pnl >= 0);
  const losingDays = dailyPnL.filter(d => d.pnl < 0);
  const avgWin = winningDays.length > 0 ? winningDays.reduce((s, d) => s + d.pnl, 0) / winningDays.length : 0;
  const avgLoss = losingDays.length > 0 ? losingDays.reduce((s, d) => s + d.pnl, 0) / losingDays.length : 0;
  const bestDay = dailyPnL.length > 0 ? dailyPnL.reduce((best, d) => d.pnl > best.pnl ? d : best, dailyPnL[0]) : null;
  const worstDay = dailyPnL.length > 0 ? dailyPnL.reduce((worst, d) => d.pnl < worst.pnl ? d : worst, dailyPnL[0]) : null;

  // Compute by-symbol P&L from activities
  const bySymbol = {};
  activities.forEach(act => {
    const sym = act.symbol || 'Unknown';
    if (!bySymbol[sym]) bySymbol[sym] = { symbol: sym, pnl: 0, trades: 0 };
    const net = parseFloat(act.net_amount || 0);
    if (act.side === 'buy') {
      bySymbol[sym].pnl -= net;
    } else if (act.side === 'sell') {
      bySymbol[sym].pnl += net;
    }
    bySymbol[sym].trades++;
  });
  const symbolPnL = Object.values(bySymbol).sort((a, b) => b.pnl - a.pnl);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-[var(--text-muted)]">Loading P&L data...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/30 text-[var(--accent-red)] px-4 py-3 rounded-lg text-sm">
        Error loading P&L data: {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="pnl-summary-grid">
        <div className="pnl-summary-card">
          <div className="pnl-summary-label">📊 Total P&L (30d)</div>
          <div className={`pnl-summary-value ${totalPnL >= 0 ? 'positive' : 'negative'}`}>
            {totalPnL >= 0 ? '+' : ''}{formatMoney(totalPnL)}
          </div>
        </div>
        <div className="pnl-summary-card">
          <div className="pnl-summary-label">✅ Winning Days</div>
          <div className="pnl-summary-value positive">{winningDays.length}</div>
        </div>
        <div className="pnl-summary-card">
          <div className="pnl-summary-label">❌ Losing Days</div>
          <div className="pnl-summary-value negative">{losingDays.length}</div>
        </div>
        <div className="pnl-summary-card">
          <div className="pnl-summary-label">📈 Avg Win</div>
          <div className="pnl-summary-value positive">{formatMoney(avgWin)}</div>
        </div>
        <div className="pnl-summary-card">
          <div className="pnl-summary-label">📉 Avg Loss</div>
          <div className="pnl-summary-value negative">{formatMoney(avgLoss)}</div>
        </div>
        <div className="pnl-summary-card">
          <div className="pnl-summary-label">🏆 Best Day</div>
          <div className="pnl-summary-value positive">
            {bestDay ? `${formatMoney(bestDay.pnl)} (${bestDay.date})` : '—'}
          </div>
        </div>
      </div>

      {/* Daily P&L Table */}
      <div className="pnl-daily-table">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Daily P&L</th>
              <th>P&L %</th>
              <th>Equity</th>
            </tr>
          </thead>
          <tbody>
            {dailyPnL.slice().reverse().map((day, i) => (
              <tr key={i}>
                <td className={day.pnl >= 0 ? 'positive' : 'negative'}>{day.date}</td>
                <td className={day.pnl >= 0 ? 'positive' : 'negative'}>
                  {day.pnl >= 0 ? '+' : ''}{formatMoney(day.pnl)}
                </td>
                <td className={day.pnl >= 0 ? 'positive' : 'negative'}>
                  {day.pnlPct >= 0 ? '+' : ''}{day.pnlPct.toFixed(2)}%
                </td>
                <td>{formatMoney(day.equity)}</td>
              </tr>
            ))}
            {dailyPnL.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                  No historical data available yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* By Symbol P&L */}
      {symbolPnL.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">P&L by Symbol</h3>
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-4 py-3 text-left text-[var(--text-muted)] font-medium">Symbol</th>
                    <th className="px-4 py-3 text-right text-[var(--text-muted)] font-medium">Net P&L</th>
                    <th className="px-4 py-3 text-right text-[var(--text-muted)] font-medium">Trades</th>
                  </tr>
                </thead>
                <tbody>
                  {symbolPnL.map((s, i) => (
                    <tr key={i} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-card-hover)] transition-colors">
                      <td className="px-4 py-3 font-medium text-[var(--text-primary)]">{s.symbol}</td>
                      <td className={`px-4 py-3 text-right font-medium ${s.pnl >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                        {s.pnl >= 0 ? '+' : ''}{formatMoney(s.pnl)}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{s.trades}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}