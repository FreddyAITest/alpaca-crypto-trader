import { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid, Area, AreaChart } from 'recharts';

const CHART_MODES = [
  { id: 'daily-pnl', label: 'Daily P&L', icon: '📊' },
  { id: 'weekly-pnl', label: 'Weekly P&L', icon: '📅' },
  { id: 'cumulative', label: 'Cumulative Returns', icon: '📈' },
];

export default function PnLChart({ history }) {
  const [mode, setMode] = useState('daily-pnl');

  const processedData = useMemo(() => {
    if (!history || !history.equity || history.equity.length === 0) return null;

    const timestamps = history.timestamp;
    const equities = history.equity.map(v => parseFloat(v));
    const baseline = equities[0];

    // Daily P&L data - group by day
    const dailyMap = {};
    for (let i = 0; i < timestamps.length; i++) {
      const date = new Date(timestamps[i] * 1000);
      const dayKey = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (!dailyMap[dayKey]) {
        dailyMap[dayKey] = { date: dayKey, open: equities[i], close: equities[i] };
      }
      dailyMap[dayKey].close = equities[i];
    }
    const dailyPnL = Object.values(dailyMap).map(d => ({
      ...d,
      pnl: d.close - d.open,
      pnlPct: d.open > 0 ? ((d.close - d.open) / d.open) * 100 : 0,
    }));

    // Weekly P&L data - group by week
    const weeklyMap = {};
    for (let i = 0; i < timestamps.length; i++) {
      const date = new Date(timestamps[i] * 1000);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      const weekKey = `Wk ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      if (!weeklyMap[weekKey]) {
        weeklyMap[weekKey] = { week: weekKey, open: equities[i], close: equities[i] };
      }
      weeklyMap[weekKey].close = equities[i];
    }
    const weeklyPnL = Object.values(weeklyMap).map(w => ({
      ...w,
      pnl: w.close - w.open,
      pnlPct: w.open > 0 ? ((w.close - w.open) / w.open) * 100 : 0,
    }));

    // Cumulative returns data
    const cumulative = equities.map((eq, i) => ({
      date: new Date(timestamps[i] * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      returnPct: baseline > 0 ? ((eq - baseline) / baseline) * 100 : 0,
      equity: eq,
    }));

    return { dailyPnL, weeklyPnL, cumulative, baseline };
  }, [history]);

  if (!processedData) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--text-muted)]">
        No portfolio history available yet
      </div>
    );
  }

  const { dailyPnL, weeklyPnL, cumulative, baseline } = processedData;

  const CustomBarTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      const val = d.pnl;
      const pct = d.pnlPct;
      return (
        <div className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg p-3 shadow-xl">
          <p className="text-xs text-[var(--text-muted)]">{label}</p>
          <p className={`text-sm font-bold ${val >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
            {val >= 0 ? '+' : ''}{val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className={`text-xs ${val >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
            {val >= 0 ? '+' : ''}{pct.toFixed(2)}%
          </p>
        </div>
      );
    }
    return null;
  };

  const CustomCumulativeTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const val = payload[0].value;
      const eq = payload[0].payload.equity;
      return (
        <div className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg p-3 shadow-xl">
          <p className="text-xs text-[var(--text-muted)]">{label}</p>
          <p className={`text-sm font-bold ${val >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
            {val >= 0 ? '+' : ''}{val.toFixed(2)}%
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            Equity: ${eq.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </p>
        </div>
      );
    }
    return null;
  };

  // Summary stats
  const totalPnL = dailyPnL.reduce((sum, d) => sum + d.pnl, 0);
  const bestDay = dailyPnL.reduce((best, d) => d.pnl > best.pnl ? d : best, dailyPnL[0]);
  const worstDay = dailyPnL.reduce((worst, d) => d.pnl < worst.pnl ? d : worst, dailyPnL[0]);
  const avgDailyPnL = totalPnL / dailyPnL.length;
  const greenDays = dailyPnL.filter(d => d.pnl >= 0).length;
  const redDays = dailyPnL.filter(d => d.pnl < 0).length;

  const totalWkPnL = weeklyPnL.reduce((sum, w) => sum + w.pnl, 0);
  const bestWeek = weeklyPnL.reduce((best, w) => w.pnl > best.pnl ? w : best, weeklyPnL[0]);
  const worstWeek = weeklyPnL.reduce((worst, w) => w.pnl < worst.pnl ? w : worst, weeklyPnL[0]);

  return (
    <div className="space-y-4">
      {/* Mode Selector */}
      <div className="flex items-center gap-2">
        {CHART_MODES.map(m => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
              mode === m.id
                ? 'bg-[var(--accent-blue)] text-white shadow-lg shadow-[#448aff]/20'
                : 'bg-[var(--bg-input)] text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-white'
            }`}
          >
            {m.icon} {m.label}
          </button>
        ))}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <div className="bg-[var(--bg-input)] rounded-lg p-3">
          <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Total P&L</div>
          <div className={`text-sm font-bold ${totalPnL >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
            {totalPnL >= 0 ? '+' : ''}${totalPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="bg-[var(--bg-input)] rounded-lg p-3">
          <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Avg Daily</div>
          <div className={`text-sm font-bold ${avgDailyPnL >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
            {avgDailyPnL >= 0 ? '+' : ''}${avgDailyPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="bg-[var(--bg-input)] rounded-lg p-3">
          <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Best Day</div>
          <div className="text-sm font-bold text-[var(--accent-green)]">
            +${bestDay.pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="bg-[var(--bg-input)] rounded-lg p-3">
          <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Worst Day</div>
          <div className="text-sm font-bold text-[var(--accent-red)]">
            -${Math.abs(worstDay.pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
        </div>
        <div className="bg-[var(--bg-input)] rounded-lg p-3">
          <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Green / Red Days</div>
          <div className="text-sm font-bold">
            <span className="text-[var(--accent-green)]">{greenDays}</span>
            <span className="text-[var(--text-muted)]"> / </span>
            <span className="text-[var(--accent-red)]">{redDays}</span>
          </div>
        </div>
        <div className="bg-[var(--bg-input)] rounded-lg p-3">
          <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Cumulative Return</div>
          <div className={`text-sm font-bold ${cumulative[cumulative.length-1]?.returnPct >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
            {cumulative.length > 0 ? `${cumulative[cumulative.length-1].returnPct >= 0 ? '+' : ''}${cumulative[cumulative.length-1].returnPct.toFixed(2)}%` : '—'}
          </div>
        </div>
      </div>

      {/* Chart */}
      {mode === 'daily-pnl' && (
        <div>
          <h4 className="text-xs text-[var(--text-muted)] mb-2">Daily P&L (last 30 days)</h4>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={dailyPnL} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3148" />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                tickFormatter={(v) => `$${v.toFixed(0)}`}
              />
              <Tooltip content={<CustomBarTooltip />} />
              <ReferenceLine y={0} stroke="#8b8fa3" strokeDasharray="3 3" />
              <Bar
                dataKey="pnl"
                radius={[4, 4, 0, 0]}
                fill="#448aff"
                cell={({ payload }) => ({
                  fill: payload.pnl >= 0 ? '#00c853' : '#ff1744',
                })}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {mode === 'weekly-pnl' && (
        <div>
          <h4 className="text-xs text-[var(--text-muted)] mb-2">Weekly P&L (last 4 weeks)</h4>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={weeklyPnL} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3148" />
              <XAxis
                dataKey="week"
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                tickFormatter={(v) => `$${v.toFixed(0)}`}
              />
              <Tooltip content={<CustomBarTooltip />} />
              <ReferenceLine y={0} stroke="#8b8fa3" strokeDasharray="3 3" />
              <Bar
                dataKey="pnl"
                radius={[4, 4, 0, 0]}
                cell={({ payload }) => ({
                  fill: payload.pnl >= 0 ? '#00c853' : '#ff1744',
                })}
              />
            </BarChart>
          </ResponsiveContainer>

          {/* Weekly Summary */}
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-[var(--bg-input)] rounded-lg p-3">
              <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Total Weekly P&L</div>
              <div className={`text-sm font-bold ${totalWkPnL >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                {totalWkPnL >= 0 ? '+' : ''}${totalWkPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="bg-[var(--bg-input)] rounded-lg p-3">
              <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Best Week</div>
              <div className="text-sm font-bold text-[var(--accent-green)]">
                +${bestWeek.pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="bg-[var(--bg-input)] rounded-lg p-3">
              <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Worst Week</div>
              <div className="text-sm font-bold text-[var(--accent-red)]">
                -${Math.abs(worstWeek.pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="bg-[var(--bg-input)] rounded-lg p-3">
              <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Avg Weekly</div>
              <div className={`text-sm font-bold ${totalWkPnL/weeklyPnL.length >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                {totalWkPnL/weeklyPnL.length >= 0 ? '+' : ''}${(totalWkPnL/weeklyPnL.length).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </div>
      )}

      {mode === 'cumulative' && (
        <div>
          <h4 className="text-xs text-[var(--text-muted)] mb-2">Cumulative Returns (%)</h4>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={cumulative} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <defs>
                <linearGradient id="returnGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#448aff" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#448aff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3148" />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                tickFormatter={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`}
              />
              <Tooltip content={<CustomCumulativeTooltip />} />
              <ReferenceLine y={0} stroke="#8b8fa3" strokeDasharray="3 3" />
              <Area
                type="monotone"
                dataKey="returnPct"
                stroke="#448aff"
                strokeWidth={2}
                fill="url(#returnGradient)"
                dot={false}
                activeDot={{ r: 4, fill: 'var(--accent-blue)', stroke: 'var(--bg-primary)', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}