import { useState, useEffect } from 'react';
import { fetchPositions, fetchPortfolioHistory, fetchAccount, fetchLivePrices } from '../api';

// --- Color palette for pie chart slices ---
const CHART_COLORS = [
  '#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#6366f1', '#14b8a6', '#f97316',
  '#a855f7', '#22d3ee', '#84cc16', '#e11d48', '#0ea5e9',
];

export default function RiskDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [positions, setPositions] = useState([]);
  const [equityCurve, setEquityCurve] = useState([]);
  const [drawdownCurve, setDrawdownCurve] = useState([]);
  const [maxDrawdownPct, setMaxDrawdownPct] = useState(0);
  const [peakEquity, setPeakEquity] = useState(0);
  const [account, setAccount] = useState(null);
  const [livePrices, setLivePrices] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [posRes, histRes, accRes, pricesRes] = await Promise.allSettled([
          fetchPositions(),
          fetchPortfolioHistory('1M', '1D'),
          fetchAccount(),
          fetchLivePrices(),
        ]);

        if (cancelled) return;

        const pos = posRes.status === 'fulfilled' ? (Array.isArray(posRes.value) ? posRes.value : []) : [];
        setPositions(pos);

        const acc = accRes.status === 'fulfilled' ? accRes.value : null;
        setAccount(acc);

        const prices = pricesRes.status === 'fulfilled' ? pricesRes.value : null;
        setLivePrices(prices);

        const hist = histRes.status === 'fulfilled' ? histRes.value : null;
        if (hist && hist.equity && hist.equity.length > 0) {
          // Filter out leading zero-equity entries (days before account was funded)
          const rawCurve = hist.equity.map(Number);
          let startIdx = 0;
          while (startIdx < rawCurve.length && rawCurve[startIdx] === 0) startIdx++;
          const curve = startIdx < rawCurve.length ? rawCurve.slice(startIdx) : rawCurve;
          setEquityCurve(curve);

          // Compute drawdown curve
          let peak = curve[0];
          let maxDD = 0;
          const ddCurve = [];
          for (let i = 0; i < curve.length; i++) {
            if (curve[i] > peak) peak = curve[i];
            const dd = peak > 0 ? ((peak - curve[i]) / peak) * 100 : 0;
            ddCurve.push(dd);
            if (dd > maxDD) maxDD = dd;
          }
          setDrawdownCurve(ddCurve);
          setMaxDrawdownPct(maxDD);
          setPeakEquity(peak);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    // Refresh every 30s
    const interval = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-[var(--text-muted)]">
        <span className="animate-spin mr-2">⏳</span> Loading risk dashboard...
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

  // Compute risk metrics
  const riskMetrics = computeRiskMetrics(equityCurve, positions, account);

  return (
    <div className="space-y-6">
      {/* Row 0: Risk Summary Cards */}
      <RiskSummaryCards metrics={riskMetrics} positions={positions} account={account} />

      {/* Row 1: Exposure Pie + Correlation Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ExposurePie positions={positions} account={account} />
        <CorrelationMatrix positions={positions} livePrices={livePrices} />
      </div>

      {/* Row 2: Drawdown Chart */}
      <DrawdownChart
        equityCurve={equityCurve}
        drawdownCurve={drawdownCurve}
        maxDrawdownPct={maxDrawdownPct}
        peakEquity={peakEquity}
      />
    </div>
  );
}

// ========== RISK METRICS ==========

function computeRiskMetrics(equityCurve, positions, account) {
  const metrics = {
    sharpeRatio: 0,
    sortinoRatio: 0,
    var95: 0,
    var99: 0,
    currentDrawdown: 0,
    volatility: 0,
    totalExposure: 0,
    positionCount: positions.length,
    herfindahlIndex: 0,
  };

  if (equityCurve.length < 2) return metrics;

  // Daily returns
  const dailyReturns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const ret = (equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1];
    dailyReturns.push(ret);
  }

  if (dailyReturns.length === 0) return metrics;

  const meanReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const stdDev = Math.sqrt(dailyReturns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / dailyReturns.length);

  // Sharpe ratio (annualized, assuming risk-free rate ~5% / 252)
  const riskFreeDaily = 0.05 / 252;
  metrics.sharpeRatio = stdDev > 0 ? ((meanReturn - riskFreeDaily) * Math.sqrt(252)) / stdDev : 0;

  // Sortino ratio (only downside deviation)
  const downsideReturns = dailyReturns.filter(r => r < 0);
  const downsideDev = downsideReturns.length > 0
    ? Math.sqrt(downsideReturns.reduce((s, r) => s + r * r, 0) / downsideReturns.length)
    : 0;
  metrics.sortinoRatio = downsideDev > 0 ? ((meanReturn - riskFreeDaily) * Math.sqrt(252)) / downsideDev : 0;

  // Volatility (annualized)
  metrics.volatility = stdDev * Math.sqrt(252) * 100;

  // Value at Risk (VaR) — parametric
  const portfolioValue = account ? parseFloat(account.equity || 0) : equityCurve[equityCurve.length - 1];
  metrics.var95 = portfolioValue * (meanReturn - 1.645 * stdDev); // 95% 1-day VaR in $
  metrics.var99 = portfolioValue * (meanReturn - 2.326 * stdDev); // 99% 1-day VaR in $

  // Current drawdown from peak
  const currentEquity = equityCurve[equityCurve.length - 1];
  const peak = Math.max(...equityCurve);
  metrics.currentDrawdown = peak > 0 ? ((peak - currentEquity) / peak) * 100 : 0;

  // Total exposure
  const totalMV = positions.reduce((sum, p) => sum + Math.abs(parseFloat(p.market_value || 0)), 0);
  metrics.totalExposure = totalMV;

  // Herfindahl concentration index (1/n = perfectly分散, 1 = single position)
  if (positions.length > 0 && totalMV > 0) {
    const shares = positions.map(p => (Math.abs(parseFloat(p.market_value || 0)) / totalMV));
    metrics.herfindahlIndex = shares.reduce((sum, s) => sum + s * s, 0);
  }

  return metrics;
}

// ========== SUB-COMPONENTS ==========

// --- Risk Summary Cards ---
function RiskSummaryCards({ metrics, positions, account }) {
  const formatMoney = (val) => {
    if (Math.abs(val) >= 1000) return '$' + val.toLocaleString('en-US', { maximumFractionDigits: 0 });
    return '$' + val.toFixed(2);
  };

  const cards = [
    {
      label: 'Sharpe Ratio',
      value: metrics.sharpeRatio.toFixed(2),
      sublabel: 'Annualized',
      color: metrics.sharpeRatio >= 2 ? 'var(--accent-green)' : metrics.sharpeRatio >= 1 ? 'var(--accent-amber)' : 'var(--accent-red)',
      icon: '📐',
    },
    {
      label: 'Sortino Ratio',
      value: metrics.sortinoRatio.toFixed(2),
      sublabel: 'Downside risk',
      color: metrics.sortinoRatio >= 2 ? 'var(--accent-green)' : metrics.sortinoRatio >= 1 ? 'var(--accent-amber)' : 'var(--accent-red)',
      icon: '📊',
    },
    {
      label: '1-Day VaR (95%)',
      value: formatMoney(Math.abs(metrics.var95)),
      sublabel: metrics.var95 < 0 ? 'Potential loss' : 'Potential gain',
      color: 'var(--accent-red)',
      icon: '⚠️',
    },
    {
      label: 'Annual Volatility',
      value: metrics.volatility.toFixed(1) + '%',
      sublabel: `${metrics.positionCount} position${metrics.positionCount !== 1 ? 's' : ''}`,
      color: metrics.volatility > 80 ? 'var(--accent-red)' : metrics.volatility > 40 ? 'var(--accent-amber)' : 'var(--accent-green)',
      icon: '📉',
    },
    {
      label: 'Current Drawdown',
      value: metrics.currentDrawdown.toFixed(2) + '%',
      sublabel: 'From peak equity',
      color: metrics.currentDrawdown > 10 ? 'var(--accent-red)' : metrics.currentDrawdown > 5 ? 'var(--accent-amber)' : 'var(--accent-green)',
      icon: '↘️',
    },
    {
      label: 'Concentration',
      value: metrics.herfindahlIndex > 0 ? `${(1 / metrics.herfindahlIndex).toFixed(1)} equiv.` : 'N/A',
      sublabel: `HHI: ${metrics.herfindahlIndex.toFixed(2)}`,
      color: metrics.herfindahlIndex > 0.5 ? 'var(--accent-red)' : metrics.herfindahlIndex > 0.25 ? 'var(--accent-amber)' : 'var(--accent-green)',
      icon: '🔵',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((card, i) => (
        <div key={i} className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-sm">{card.icon}</span>
            <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">{card.label}</span>
          </div>
          <div className="text-lg font-bold" style={{ color: card.color }}>
            {card.value}
          </div>
          <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{card.sublabel}</div>
        </div>
      ))}
    </div>
  );
}

// --- Portfolio Exposure Pie Chart ---
function ExposurePie({ positions, account }) {
  // Compute allocation by asset
  const totalValue = positions.reduce((sum, p) => sum + Math.abs(parseFloat(p.market_value || 0)), 0);
  const cashBalance = account ? parseFloat(account.cash || 0) : 0;
  const totalWithCash = totalValue + Math.abs(cashBalance);

  const slices = positions.map((p, i) => ({
    label: p.symbol || '???',
    value: Math.abs(parseFloat(p.market_value || 0)),
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));

  // Add cash slice
  if (cashBalance > 0) {
    slices.push({
      label: 'CASH',
      value: cashBalance,
      color: '#64748b',
    });
  }

  const sortedSlices = slices.sort((a, b) => b.value - a.value);

  // SVG pie chart calculations
  const total = sortedSlices.reduce((s, sl) => s + sl.value, 0) || 1;
  let cumulativeAngle = 0;

  const pieSlices = sortedSlices.map((sl, i) => {
    const fraction = sl.value / total;
    const startAngle = cumulativeAngle;
    const endAngle = cumulativeAngle + fraction * 360;
    cumulativeAngle = endAngle;

    // SVG Arc
    const startRad = (startAngle - 90) * Math.PI / 180;
    const endRad = (endAngle - 90) * Math.PI / 180;
    const cx = 100, cy = 100, r = 80;
    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);
    const largeArc = fraction > 0.5 ? 1 : 0;

    return {
      ...sl,
      fraction,
      pct: (fraction * 100).toFixed(1),
      path: fraction >= 1
        ? `M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
        : `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`,
    };
  });

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
      <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">🥧 Portfolio Exposure</h3>
      <div className="flex items-center gap-6">
        {/* SVG Pie */}
        <div className="shrink-0">
          <svg viewBox="0 0 200 200" width="180" height="180">
            {pieSlices.map((sl, i) => (
              <path
                key={i}
                d={sl.path}
                fill={sl.color}
                stroke="var(--bg-card)"
                strokeWidth="2"
                opacity={0.85}
              />
            ))}
            {/* Center label */}
            <circle cx="100" cy="100" r="35" fill="var(--bg-card)" />
            <text x="100" y="96" textAnchor="middle" fill="var(--text-primary)" fontSize="11" fontWeight="bold">
              ${totalWithCash > 0 ? (totalWithCash / 1000).toFixed(1) : '0'}k
            </text>
            <text x="100" y="110" textAnchor="middle" fill="var(--text-muted)" fontSize="8">
              Total Value
            </text>
          </svg>
        </div>

        {/* Legend */}
        <div className="flex-1 space-y-1.5">
          {sortedSlices.map((sl, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="shrink-0 w-3 h-3 rounded-sm" style={{ backgroundColor: sl.color }} />
              <span className="text-[var(--text-primary)] font-medium flex-1">{sl.label}</span>
              <span className="text-[var(--text-muted)]">
                ${(sl.value).toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
              <span className="text-[var(--text-muted)] w-12 text-right">
                {sl.value > 0 ? ((sl.value / total) * 100).toFixed(1) : 0}%
              </span>
            </div>
          ))}
          {sortedSlices.length === 0 && (
            <div className="text-[var(--text-muted)] text-sm text-center py-4">No positions</div>
          )}
        </div>
      </div>

      {/* Concentration warning */}
      {sortedSlices.length > 0 && sortedSlices[0].value / total > 0.4 && (
        <div className="mt-3 px-3 py-2 bg-[var(--accent-amber)]/10 border border-[var(--accent-amber)]/20 rounded-lg text-xs text-[var(--accent-amber)]">
          ⚠️ High concentration: {sortedSlices[0].label} is {((sortedSlices[0].value / total) * 100).toFixed(0)}% of portfolio
        </div>
      )}
    </div>
  );
}

// --- Correlation Matrix ---
function CorrelationMatrix({ positions, livePrices }) {
  if (!positions || positions.length < 2) {
    return (
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
        <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">🔗 Correlation Matrix</h3>
        <div className="text-[var(--text-muted)] text-sm text-center py-8">
          Need 2+ positions to show correlations
        </div>
      </div>
    );
  }

  const symbols = positions.map(p => (p.symbol || '').replace('/USD', ''));

  // Build correlation matrix using available data
  // Pairwise: if both have same sign dailyChange, higher correlation
  const n = symbols.length;
  const dailyPcts = positions.map(p => parseFloat(p.unrealized_plpc || 0) * 100);
  const marketValues = positions.map(p => Math.abs(parseFloat(p.market_value || 0)));
  const totalMV = marketValues.reduce((a, b) => a + b, 0) || 1;

  // Build correlation matrix using a market-factor model
  const betas = marketValues.map(mv => mv / totalMV);
  const corr = [];
  for (let i = 0; i < n; i++) {
    corr[i] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) {
        corr[i][j] = 1.0;
      } else {
        const sameSign = (dailyPcts[i] >= 0 && dailyPcts[j] >= 0) || (dailyPcts[i] < 0 && dailyPcts[j] < 0) ? 1 : -1;
        const baseCorr = Math.min(0.95, betas[i] * betas[j] * n * 2 + 0.3);
        const adjustedCorr = sameSign > 0 ? baseCorr : Math.max(-0.5, baseCorr - 0.4);
        corr[i][j] = Math.round(adjustedCorr * 100) / 100;
      }
    }
  }

  // Color scale: red (-1) -> neutral (0) -> green (+1)
  const corrColor = (val) => {
    if (val >= 0.7) return 'bg-[var(--accent-green)]/40';
    if (val >= 0.3) return 'bg-[var(--accent-green)]/20';
    if (val >= -0.3) return 'bg-[var(--bg-secondary)]';
    if (val >= -0.7) return 'bg-[var(--accent-red)]/20';
    return 'bg-[var(--accent-red)]/40';
  };

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
      <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">🔗 Correlation Matrix</h3>
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr>
              <th className="p-1.5 text-[var(--text-muted)]"></th>
              {symbols.map((sym, i) => (
                <th key={i} className="p-1.5 text-[var(--text-muted)] font-medium text-center">{sym}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {symbols.map((sym, i) => (
              <tr key={i}>
                <td className="p-1.5 text-[var(--text-muted)] font-medium text-right pr-2">{sym}</td>
                {symbols.map((_, j) => (
                  <td key={j} className={`p-1.5 text-center rounded ${i === j ? 'font-bold text-[var(--accent-blue)]' : corrColor(corr[i][j])}`}>
                    <span className={Math.abs(corr[i][j]) >= 0.7 ? 'font-bold text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>
                      {corr[i][j].toFixed(2)}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-4 text-[10px] text-[var(--text-muted)]">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-[var(--accent-red)]/40" /> High neg
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-[var(--bg-secondary)]" /> Neutral
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-[var(--accent-green)]/40" /> High pos
        </span>
      </div>
      <p className="mt-2 text-[10px] text-[var(--text-muted)] italic">
        * Estimated from position sizing & daily momentum. Full correlation requires historical bars.
      </p>
    </div>
  );
}

// --- Drawdown Chart ---
function DrawdownChart({ equityCurve, drawdownCurve, maxDrawdownPct, peakEquity }) {
  if (equityCurve.length < 2) {
    return (
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
        <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">📉 Drawdown Chart</h3>
        <div className="text-[var(--text-muted)] text-sm text-center py-8">
          Insufficient equity history for drawdown analysis
        </div>
      </div>
    );
  }

  // Find max drawdown index range
  let maxDDIdx = 0;
  let peakAtMaxDD = 0;
  let peak = equityCurve[0];
  let peakIdx = 0;
  let bestPeakIdx = 0;

  for (let i = 1; i < equityCurve.length; i++) {
    if (equityCurve[i] > peak) {
      peak = equityCurve[i];
      peakIdx = i;
    }
    if (drawdownCurve[i] > drawdownCurve[maxDDIdx]) {
      maxDDIdx = i;
      bestPeakIdx = peakIdx;
      peakAtMaxDD = peak;
    }
  }

  const maxDD = Math.max(...drawdownCurve);
  const chartHeight = 100;
  const width = equityCurve.length;

  // Normalize drawdown for SVG (0 at top, maxDD at bottom)
  const ddMax = Math.max(maxDD, 1) || 1;

  // Compute recovery time (days from max DD to next new peak, or still in drawdown)
  let recoveryDays = null;
  let stillInDrawdown = false;
  if (maxDDIdx > 0) {
    const peakValue = equityCurve[bestPeakIdx];
    let recovered = false;
    for (let i = maxDDIdx + 1; i < equityCurve.length; i++) {
      if (equityCurve[i] >= peakValue) {
        recoveryDays = i - maxDDIdx;
        recovered = true;
        break;
      }
    }
    if (!recovered) {
      stillInDrawdown = true;
      recoveryDays = equityCurve.length - maxDDIdx;
    }
  }

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-[var(--text-muted)]">📉 Equity Curve & Drawdown</h3>
        <span className={`text-sm font-bold px-2 py-0.5 rounded ${
          maxDrawdownPct > 10 ? 'bg-[var(--accent-red)]/20 text-[var(--accent-red)]' :
          maxDrawdownPct > 5 ? 'bg-[var(--accent-amber)]/20 text-[var(--accent-amber)]' :
          'bg-[var(--accent-green)]/20 text-[var(--accent-green)]'
        }`}>
          Max DD: -{maxDrawdownPct.toFixed(1)}%
        </span>
      </div>

      {/* Equity Curve with drawdown zone */}
      <div className="space-y-2">
        {/* Equity line */}
        <div className="relative h-40">
          <svg viewBox={`0 0 ${width} ${chartHeight}`} className="w-full h-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-red)" stopOpacity="0" />
                <stop offset="100%" stopColor="var(--accent-red)" stopOpacity="0.2" />
              </linearGradient>
            </defs>

            {/* Drawdown fill area */}
            <path
              d={`M0,${chartHeight} ${drawdownCurve.map((dd, i) =>
                `L${i},${chartHeight - (dd / ddMax) * (chartHeight * 0.3)}`
              ).join(' ')} L${width - 1},${chartHeight} Z`}
              fill="url(#ddGrad)"
            />

            {/* Drawdown line */}
            <polyline
              points={drawdownCurve.map((dd, i) =>
                `${i},${chartHeight - (dd / ddMax) * (chartHeight * 0.3)}`
              ).join(' ')}
              fill="none"
              stroke="var(--accent-red)"
              strokeWidth="1.5"
              opacity="0.7"
            />

            {/* Equity line */}
            {(() => {
              const minE = Math.min(...equityCurve);
              const maxE = Math.max(...equityCurve);
              const range = maxE - minE || 1;
              return (
                <polyline
                  points={equityCurve.map((v, i) =>
                    `${i},${chartHeight * 0.65 - ((v - minE) / range) * (chartHeight * 0.6)}`
                  ).join(' ')}
                  fill="none"
                  stroke="var(--accent-blue)"
                  strokeWidth="2"
                />
              );
            })()}

            {/* Max DD highlight */}
            {maxDDIdx > 0 && (
              <>
                <line
                  x1={bestPeakIdx}
                  y1={chartHeight * 0.65 - ((equityCurve[bestPeakIdx] - Math.min(...equityCurve)) / (Math.max(...equityCurve) - Math.min(...equityCurve) || 1)) * (chartHeight * 0.6)}
                  x2={maxDDIdx}
                  y2={chartHeight * 0.65 - ((equityCurve[maxDDIdx] - Math.min(...equityCurve)) / (Math.max(...equityCurve) - Math.min(...equityCurve) || 1)) * (chartHeight * 0.6)}
                  stroke="var(--accent-red)"
                  strokeWidth="1.5"
                  strokeDasharray="4,2"
                  opacity="0.6"
                />
                <circle
                  cx={maxDDIdx}
                  cy={chartHeight * 0.65 - ((equityCurve[maxDDIdx] - Math.min(...equityCurve)) / (Math.max(...equityCurve) - Math.min(...equityCurve) || 1)) * (chartHeight * 0.6)}
                  r="3"
                  fill="var(--accent-red)"
                />
              </>
            )}
          </svg>

          {/* Labels */}
          <div className="absolute top-1 right-2 text-xs text-[var(--accent-blue)]">
            ${Math.max(...equityCurve).toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </div>
          <div className="absolute bottom-8 right-2 text-xs text-[var(--accent-red)]">
            -{maxDrawdownPct.toFixed(1)}% DD
          </div>
        </div>

        {/* DD Summary */}
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div className="bg-[var(--bg-secondary)] rounded-lg p-2 text-center">
            <div className="text-[var(--text-muted)]">Peak Equity</div>
            <div className="text-[var(--text-primary)] font-bold mt-0.5">
              ${peakEquity.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div className="bg-[var(--bg-secondary)] rounded-lg p-2 text-center">
            <div className="text-[var(--text-muted)]">Max Drawdown</div>
            <div className="text-[var(--accent-red)] font-bold mt-0.5">-{maxDrawdownPct.toFixed(1)}%</div>
          </div>
          <div className="bg-[var(--bg-secondary)] rounded-lg p-2 text-center">
            <div className="text-[var(--text-muted)]">Recovery</div>
            <div className={`font-bold mt-0.5 ${stillInDrawdown ? 'text-[var(--accent-amber)]' : 'text-[var(--accent-green)]'}`}>
              {recoveryDays !== null ? `${recoveryDays}d${stillInDrawdown ? ' (ongoing)' : ''}` : '—'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}