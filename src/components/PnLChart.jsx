     1|import { useState, useEffect, useMemo } from 'react';
     2|import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid, Area, AreaChart } from 'recharts';
     3|
     4|const CHART_MODES = [
     5|  { id: 'daily-pnl', label: 'Daily P&L', icon: '📊' },
     6|  { id: 'weekly-pnl', label: 'Weekly P&L', icon: '📅' },
     7|  { id: 'cumulative', label: 'Cumulative Returns', icon: '📈' },
     8|];
     9|
    10|export default function PnLChart({ history }) {
    11|  const [mode, setMode] = useState('daily-pnl');
    12|
    13|  const processedData = useMemo(() => {
    14|    if (!history || !history.equity || history.equity.length === 0) return null;
    15|
    16|    const timestamps = history.timestamp;
    17|    const equities = history.equity.map(v => parseFloat(v));
    18|    const baseline = equities[0];
    19|
    20|    // Daily P&L data - group by day
    21|    const dailyMap = {};
    22|    for (let i = 0; i < timestamps.length; i++) {
    23|      const date = new Date(timestamps[i] * 1000);
    24|      const dayKey = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    25|      if (!dailyMap[dayKey]) {
    26|        dailyMap[dayKey] = { date: dayKey, open: equities[i], close: equities[i] };
    27|      }
    28|      dailyMap[dayKey].close = equities[i];
    29|    }
    30|    const dailyPnL = Object.values(dailyMap).map(d => ({
    31|      ...d,
    32|      pnl: d.close - d.open,
    33|      pnlPct: d.open > 0 ? ((d.close - d.open) / d.open) * 100 : 0,
    34|    }));
    35|
    36|    // Weekly P&L data - group by week
    37|    const weeklyMap = {};
    38|    for (let i = 0; i < timestamps.length; i++) {
    39|      const date = new Date(timestamps[i] * 1000);
    40|      const weekStart = new Date(date);
    41|      weekStart.setDate(date.getDate() - date.getDay());
    42|      const weekKey = `Wk ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    43|      if (!weeklyMap[weekKey]) {
    44|        weeklyMap[weekKey] = { week: weekKey, open: equities[i], close: equities[i] };
    45|      }
    46|      weeklyMap[weekKey].close = equities[i];
    47|    }
    48|    const weeklyPnL = Object.values(weeklyMap).map(w => ({
    49|      ...w,
    50|      pnl: w.close - w.open,
    51|      pnlPct: w.open > 0 ? ((w.close - w.open) / w.open) * 100 : 0,
    52|    }));
    53|
    54|    // Cumulative returns data
    55|    const cumulative = equities.map((eq, i) => ({
    56|      date: new Date(timestamps[i] * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    57|      returnPct: baseline > 0 ? ((eq - baseline) / baseline) * 100 : 0,
    58|      equity: eq,
    59|    }));
    60|
    61|    return { dailyPnL, weeklyPnL, cumulative, baseline };
    62|  }, [history]);
    63|
    64|  if (!processedData) {
    65|    return (
    66|      <div className="flex items-center justify-center h-48 text-[var(--text-muted)]">
    67|        No portfolio history available yet
    68|      </div>
    69|    );
    70|  }
    71|
    72|  const { dailyPnL, weeklyPnL, cumulative, baseline } = processedData;
    73|
    74|  const CustomBarTooltip = ({ active, payload, label }) => {
    75|    if (active && payload && payload.length) {
    76|      const d = payload[0].payload;
    77|      const val = d.pnl;
    78|      const pct = d.pnlPct;
    79|      return (
    80|        <div className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg p-3 shadow-xl">
    81|          <p className="text-xs text-[var(--text-muted)]">{label}</p>
    82|          <p className={`text-sm font-bold ${val >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
    83|            {val >= 0 ? '+' : ''}{val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    84|          </p>
    85|          <p className={`text-xs ${val >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
    86|            {val >= 0 ? '+' : ''}{pct.toFixed(2)}%
    87|          </p>
    88|        </div>
    89|      );
    90|    }
    91|    return null;
    92|  };
    93|
    94|  const CustomCumulativeTooltip = ({ active, payload, label }) => {
    95|    if (active && payload && payload.length) {
    96|      const val = payload[0].value;
    97|      const eq = payload[0].payload.equity;
    98|      return (
    99|        <div className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg p-3 shadow-xl">
   100|          <p className="text-xs text-[var(--text-muted)]">{label}</p>
   101|          <p className={`text-sm font-bold ${val >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
   102|            {val >= 0 ? '+' : ''}{val.toFixed(2)}%
   103|          </p>
   104|          <p className="text-xs text-[var(--text-muted)]">
   105|            Equity: ${eq.toLocaleString('en-US', { minimumFractionDigits: 2 })}
   106|          </p>
   107|        </div>
   108|      );
   109|    }
   110|    return null;
   111|  };
   112|
   113|  // Summary stats
   114|  const totalPnL = dailyPnL.reduce((sum, d) => sum + d.pnl, 0);
   115|  const bestDay = dailyPnL.reduce((best, d) => d.pnl > best.pnl ? d : best, dailyPnL[0]);
   116|  const worstDay = dailyPnL.reduce((worst, d) => d.pnl < worst.pnl ? d : worst, dailyPnL[0]);
   117|  const avgDailyPnL = totalPnL / dailyPnL.length;
   118|  const greenDays = dailyPnL.filter(d => d.pnl >= 0).length;
   119|  const redDays = dailyPnL.filter(d => d.pnl < 0).length;
   120|
   121|  const totalWkPnL = weeklyPnL.reduce((sum, w) => sum + w.pnl, 0);
   122|  const bestWeek = weeklyPnL.reduce((best, w) => w.pnl > best.pnl ? w : best, weeklyPnL[0]);
   123|  const worstWeek = weeklyPnL.reduce((worst, w) => w.pnl < worst.pnl ? w : worst, weeklyPnL[0]);
   124|
   125|  return (
   126|    <div className="space-y-4">
   127|      {/* Mode Selector */}
   128|      <div className="flex items-center gap-2">
   129|        {CHART_MODES.map(m => (
   130|          <button
   131|            key={m.id}
   132|            onClick={() => setMode(m.id)}
   133|            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
   134|              mode === m.id
   135|                ? 'bg-[var(--accent-blue)] text-white shadow-lg shadow-[#448aff]/20'
   136|                : 'bg-[var(--bg-input)] text-[var(--text-muted)] hover:bg-[var(--border)] hover:text-white'
   137|            }`}
   138|          >
   139|            {m.icon} {m.label}
   140|          </button>
   141|        ))}
   142|      </div>
   143|
   144|      {/* Summary Stats */}
   145|      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
   146|        <div className="bg-[var(--bg-input)] rounded-lg p-3">
   147|          <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Total P&L</div>
   148|          <div className={`text-sm font-bold ${totalPnL >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
   149|            {totalPnL >= 0 ? '+' : ''}${totalPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}
   150|          </div>
   151|        </div>
   152|        <div className="bg-[var(--bg-input)] rounded-lg p-3">
   153|          <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Avg Daily</div>
   154|          <div className={`text-sm font-bold ${avgDailyPnL >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
   155|            {avgDailyPnL >= 0 ? '+' : ''}${avgDailyPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}
   156|          </div>
   157|        </div>
   158|        <div className="bg-[var(--bg-input)] rounded-lg p-3">
   159|          <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Best Day</div>
   160|          <div className="text-sm font-bold text-[var(--accent-green)]">
   161|            +${bestDay.pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}
   162|          </div>
   163|        </div>
   164|        <div className="bg-[var(--bg-input)] rounded-lg p-3">
   165|          <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Worst Day</div>
   166|          <div className="text-sm font-bold text-[var(--accent-red)]">
   167|            -${Math.abs(worstDay.pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}
   168|          </div>
   169|        </div>
   170|        <div className="bg-[var(--bg-input)] rounded-lg p-3">
   171|          <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Green / Red Days</div>
   172|          <div className="text-sm font-bold">
   173|            <span className="text-[var(--accent-green)]">{greenDays}</span>
   174|            <span className="text-[var(--text-muted)]"> / </span>
   175|            <span className="text-[var(--accent-red)]">{redDays}</span>
   176|          </div>
   177|        </div>
   178|        <div className="bg-[var(--bg-input)] rounded-lg p-3">
   179|          <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Cumulative Return</div>
   180|          <div className={`text-sm font-bold ${cumulative[cumulative.length-1]?.returnPct >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
   181|            {cumulative.length > 0 ? `${cumulative[cumulative.length-1].returnPct >= 0 ? '+' : ''}${cumulative[cumulative.length-1].returnPct.toFixed(2)}%` : '—'}
   182|          </div>
   183|        </div>
   184|      </div>
   185|
   186|      {/* Chart */}
   187|      {mode === 'daily-pnl' && (
   188|        <div>
   189|          <h4 className="text-xs text-[var(--text-muted)] mb-2">Daily P&L (last 30 days)</h4>
   190|          <ResponsiveContainer width="100%" height={280}>
   191|            <BarChart data={dailyPnL} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
   192|              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
   193|              <XAxis
   194|                dataKey="date"
   195|                axisLine={false}
   196|                tickLine={false}
   197|                tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
   198|              />
   199|              <YAxis
   200|                axisLine={false}
   201|                tickLine={false}
   202|                tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
   203|                tickFormatter={(v) => `$${v.toFixed(0)}`}
   204|              />
   205|              <Tooltip content={<CustomBarTooltip />} />
   206|              <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="3 3" />
   207|              <Bar
   208|                dataKey="pnl"
   209|                radius={[4, 4, 0, 0]}
   210|                fill="var(--accent-blue)"
   211|                cell={({ payload }) => ({
   212|                  fill: payload.pnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
   213|                })}
   214|              />
   215|            </BarChart>
   216|          </ResponsiveContainer>
   217|        </div>
   218|      )}
   219|
   220|      {mode === 'weekly-pnl' && (
   221|        <div>
   222|          <h4 className="text-xs text-[var(--text-muted)] mb-2">Weekly P&L (last 4 weeks)</h4>
   223|          <ResponsiveContainer width="100%" height={280}>
   224|            <BarChart data={weeklyPnL} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
   225|              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
   226|              <XAxis
   227|                dataKey="week"
   228|                axisLine={false}
   229|                tickLine={false}
   230|                tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
   231|              />
   232|              <YAxis
   233|                axisLine={false}
   234|                tickLine={false}
   235|                tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
   236|                tickFormatter={(v) => `$${v.toFixed(0)}`}
   237|              />
   238|              <Tooltip content={<CustomBarTooltip />} />
   239|              <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="3 3" />
   240|              <Bar
   241|                dataKey="pnl"
   242|                radius={[4, 4, 0, 0]}
   243|                cell={({ payload }) => ({
   244|                  fill: payload.pnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
   245|                })}
   246|              />
   247|            </BarChart>
   248|          </ResponsiveContainer>
   249|
   250|          {/* Weekly Summary */}
   251|          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
   252|            <div className="bg-[var(--bg-input)] rounded-lg p-3">
   253|              <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Total Weekly P&L</div>
   254|              <div className={`text-sm font-bold ${totalWkPnL >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
   255|                {totalWkPnL >= 0 ? '+' : ''}${totalWkPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}
   256|              </div>
   257|            </div>
   258|            <div className="bg-[var(--bg-input)] rounded-lg p-3">
   259|              <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Best Week</div>
   260|              <div className="text-sm font-bold text-[var(--accent-green)]">
   261|                +${bestWeek.pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}
   262|              </div>
   263|            </div>
   264|            <div className="bg-[var(--bg-input)] rounded-lg p-3">
   265|              <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Worst Week</div>
   266|              <div className="text-sm font-bold text-[var(--accent-red)]">
   267|                -${Math.abs(worstWeek.pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}
   268|              </div>
   269|            </div>
   270|            <div className="bg-[var(--bg-input)] rounded-lg p-3">
   271|              <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Avg Weekly</div>
   272|              <div className={`text-sm font-bold ${totalWkPnL/weeklyPnL.length >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
   273|                {totalWkPnL/weeklyPnL.length >= 0 ? '+' : ''}${(totalWkPnL/weeklyPnL.length).toLocaleString('en-US', { minimumFractionDigits: 2 })}
   274|              </div>
   275|            </div>
   276|          </div>
   277|        </div>
   278|      )}
   279|
   280|      {mode === 'cumulative' && (
   281|        <div>
   282|          <h4 className="text-xs text-[var(--text-muted)] mb-2">Cumulative Returns (%)</h4>
   283|          <ResponsiveContainer width="100%" height={280}>
   284|            <AreaChart data={cumulative} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
   285|              <defs>
   286|                <linearGradient id="returnGradient" x1="0" y1="0" x2="0" y2="1">
   287|                  <stop offset="5%" stopColor="var(--accent-blue)" stopOpacity={0.3} />
   288|                  <stop offset="95%" stopColor="var(--accent-blue)" stopOpacity={0} />
   289|                </linearGradient>
   290|              </defs>
   291|              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
   292|              <XAxis
   293|                dataKey="date"
   294|                axisLine={false}
   295|                tickLine={false}
   296|                tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
   297|              />
   298|              <YAxis
   299|                axisLine={false}
   300|                tickLine={false}
   301|                tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
   302|                tickFormatter={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`}
   303|              />
   304|              <Tooltip content={<CustomCumulativeTooltip />} />
   305|              <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="3 3" />
   306|              <Area
   307|                type="monotone"
   308|                dataKey="returnPct"
   309|                stroke="var(--accent-blue)"
   310|                strokeWidth={2}
   311|                fill="url(#returnGradient)"
   312|                dot={false}
   313|                activeDot={{ r: 4, fill: 'var(--accent-blue)', stroke: 'var(--bg-primary)', strokeWidth: 2 }}
   314|              />
   315|            </AreaChart>
   316|          </ResponsiveContainer>
   317|        </div>
   318|      )}
   319|    </div>
   320|  );
   321|}