     1|import { useState, useEffect } from 'react';
     2|import { fetchAccount, fetchActivities, fetchPortfolioHistory } from '../api';
     3|
     4|// --- Calculation Helpers ---
     5|
     6|function calcWinRate(trades) {
     7|  if (trades.length === 0) return 0;
     8|  const wins = trades.filter(t => t.pnl > 0).length;
     9|  return (wins / trades.length) * 100;
    10|}
    11|
    12|function calcAvgWinLoss(trades) {
    13|  const wins = trades.filter(t => t.pnl > 0);
    14|  const losses = trades.filter(t => t.pnl < 0);
    15|  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    16|  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;
    17|  return { avgWin, avgLoss };
    18|}
    19|
    20|function calcProfitFactor(trades) {
    21|  const wins = trades.filter(t => t.pnl > 0);
    22|  const losses = trades.filter(t => t.pnl < 0);
    23|  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
    24|  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    25|  if (grossLoss === 0) return grossWin > 0 ? Infinity : 0;
    26|  return grossWin / grossLoss;
    27|}
    28|
    29|function calcSharpeapproximation(dailyReturns) {
    30|  if (dailyReturns.length < 2) return 0;
    31|  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    32|  const stdDev = Math.sqrt(dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1));
    33|  if (stdDev === 0) return 0;
    34|  // Annualized: mean * sqrt(252) / stdDev
    35|  return (mean * Math.sqrt(252)) / stdDev;
    36|}
    37|
    38|function calcMaxDrawdown(equityCurve) {
    39|  if (equityCurve.length === 0) return { maxDrawdown: 0, peakIndex: 0, troughIndex: 0 };
    40|  let peak = equityCurve[0];
    41|  let maxDD = 0;
    42|  let peakIdx = 0;
    43|  let troughIdx = 0;
    44|  let bestPeakIdx = 0;
    45|  for (let i = 1; i < equityCurve.length; i++) {
    46|    if (equityCurve[i] > peak) {
    47|      peak = equityCurve[i];
    48|      peakIdx = i;
    49|    }
    50|    const dd = (peak - equityCurve[i]) / peak;
    51|    if (dd > maxDD) {
    52|      maxDD = dd;
    53|      troughIdx = i;
    54|      bestPeakIdx = peakIdx;
    55|    }
    56|  }
    57|  return { maxDrawdown: maxDD * 100, peakIndex: bestPeakIdx, troughIndex: troughIdx };
    58|}
    59|
    60|function calcPnLByPeriod(trades, period) {
    61|  const map = {};
    62|  for (const t of trades) {
    63|    const d = new Date(t.closeTime);
    64|    let key;
    65|    if (period === 'daily') {
    66|      key = d.toISOString().split('T')[0];
    67|    } else if (period === 'weekly') {
    68|      const startOfWeek = new Date(d);
    69|      startOfWeek.setDate(d.getDate() - d.getDay());
    70|      key = startOfWeek.toISOString().split('T')[0];
    71|    } else {
    72|      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    73|    }
    74|    if (!map[key]) map[key] = 0;
    75|    map[key] += t.pnl;
    76|  }
    77|  return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([date, pnl]) => ({ date, pnl }));
    78|}
    79|
    80|// Build trade list from activities (match buys with sells)
    81|function buildTrades(activities) {
    82|  if (!activities || activities.length === 0) return [];
    83|
    84|  // Sort by time
    85|  const sorted = [...activities].sort((a, b) =>
    86|    new Date(a.timestamp || a.transaction_datetime) - new Date(b.timestamp || b.transaction_datetime)
    87|  );
    88|
    89|  // Track open positions per symbol
    90|  const positions = {};
    91|  const trades = [];
    92|
    93|  for (const act of sorted) {
    94|    const sym = act.symbol;
    95|    const side = act.side;
    96|    const qty = parseFloat(act.qty || 0);
    97|    const price = parseFloat(act.price || 0);
    98|    const time = act.timestamp || act.transaction_datetime;
    99|
   100|    if (side === 'buy') {
   101|      if (!positions[sym]) positions[sym] = { qty: 0, totalCost: 0 };
   102|      positions[sym].qty += qty;
   103|      positions[sym].totalCost += qty * price;
   104|    } else if (side === 'sell') {
   105|      if (positions[sym] && positions[sym].qty > 0) {
   106|        const avgEntry = positions[sym].totalCost / positions[sym].qty;
   107|        const closeQty = Math.min(qty, positions[sym].qty);
   108|        const pnl = closeQty * (price - avgEntry);
   109|        const pnlPct = ((price - avgEntry) / avgEntry) * 100;
   110|
   111|        trades.push({
   112|          symbol: sym,
   113|          entryPrice: avgEntry,
   114|          exitPrice: price,
   115|          qty: closeQty,
   116|          pnl,
   117|          pnlPct,
   118|          openTime: positions[sym].openTime || time,
   119|          closeTime: time,
   120|          side: 'long',
   121|        });
   122|
   123|        positions[sym].qty -= closeQty;
   124|        positions[sym].totalCost -= closeQty * avgEntry;
   125|        if (positions[sym].qty <= 0) {
   126|          delete positions[sym];
   127|        }
   128|      }
   129|    }
   130|  }
   131|
   132|  return trades;
   133|}
   134|
   135|// --- Component ---
   136|
   137|export default function PerformanceAnalytics() {
   138|  const [loading, setLoading] = useState(true);
   139|  const [error, setError] = useState(null);
   140|  const [trades, setTrades] = useState([]);
   141|  const [equityCurve, setEquityCurve] = useState([]);
   142|  const [dailyReturns, setDailyReturns] = useState([]);
   143|  const [account, setAccount] = useState(null);
   144|  const [periodView, setPeriodView] = useState('daily');
   145|
   146|  useEffect(() => {
   147|    let cancelled = false;
   148|    async function load() {
   149|      setLoading(true);
   150|      setError(null);
   151|      try {
   152|        const [accRes, actRes, histRes] = await Promise.allSettled([
   153|          fetchAccount(),
   154|          fetchActivities(),
   155|          fetchPortfolioHistory('1M', '1D'),
   156|        ]);
   157|
   158|        if (cancelled) return;
   159|
   160|        const acc = accRes.status === 'fulfilled' ? accRes.value : null;
   161|        setAccount(acc);
   162|
   163|        const activities = actRes.status === 'fulfilled' ? actRes.value : [];
   164|        const tradeList = buildTrades(Array.isArray(activities) ? activities : []);
   165|        setTrades(tradeList);
   166|
   167|        const hist = histRes.status === 'fulfilled' ? histRes.value : null;
   168|        if (hist && hist.equity && hist.equity.length > 0) {
   169|          const curve = hist.equity.map(Number);
   170|          setEquityCurve(curve);
   171|
   172|          // Daily returns
   173|          const returns = [];
   174|          for (let i = 1; i < curve.length; i++) {
   175|            if (curve[i - 1] !== 0) {
   176|              returns.push((curve[i] - curve[i - 1]) / curve[i - 1]);
   177|            }
   178|          }
   179|          setDailyReturns(returns);
   180|        }
   181|      } catch (e) {
   182|        if (!cancelled) setError(e.message);
   183|      } finally {
   184|        if (!cancelled) setLoading(false);
   185|      }
   186|    }
   187|    load();
   188|    return () => { cancelled = true; };
   189|  }, []);
   190|
   191|  if (loading) {
   192|    return (
   193|      <div className="flex items-center justify-center py-12 text-[var(--text-muted)]">
   194|        <span className="animate-spin mr-2">⏳</span> Loading analytics...
   195|      </div>
   196|    );
   197|  }
   198|
   199|  if (error) {
   200|    return (
   201|      <div className="bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/30 text-[var(--accent-red)] px-4 py-3 rounded-lg text-sm">
   202|        ⚠️ {error}
   203|      </div>
   204|    );
   205|  }
   206|
   207|  // Compute metrics
   208|  const winRate = calcWinRate(trades);
   209|  const { avgWin, avgLoss } = calcAvgWinLoss(trades);
   210|  const profitFactor = calcProfitFactor(trades);
   211|  const sharpe = calcSharpeapproximation(dailyReturns);
   212|  const maxDD = calcMaxDrawdown(equityCurve);
   213|  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
   214|  const bestTrade = trades.length > 0 ? trades.reduce((a, b) => a.pnl > b.pnl ? a : b) : null;
   215|  const worstTrade = trades.length > 0 ? trades.reduce((a, b) => a.pnl < b.pnl ? a : b) : null;
   216|  const pnlByPeriod = calcPnLByPeriod(trades, periodView);
   217|
   218|  // Simple mini chart for equity curve
   219|  const minEquity = equityCurve.length > 0 ? Math.min(...equityCurve) : 0;
   220|  const maxEquity = equityCurve.length > 0 ? Math.max(...equityCurve) : 0;
   221|  const rangeEquity = maxEquity - minEquity || 1;
   222|
   223|  return (
   224|    <div className="space-y-6">
   225|      {/* Key Metrics Grid */}
   226|      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
   227|        <MetricCard title="Total Trades" value={trades.length} icon="📊" />
   228|        <MetricCard title="Win Rate" value={`${winRate.toFixed(1)}%`} valueClass={winRate >= 50 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'} icon="🎯" />
   229|        <MetricCard title="Profit Factor" value={profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)} valueClass={profitFactor >= 1.5 ? 'text-[var(--accent-green)]' : profitFactor >= 1 ? 'text-[#ffab00]' : 'text-[var(--accent-red)]'} icon="⚖️" />
   230|        <MetricCard title="Sharpe Ratio" value={sharpe.toFixed(2)} valueClass={sharpe >= 1 ? 'text-[var(--accent-green)]' : sharpe >= 0 ? 'text-[#ffab00]' : 'text-[var(--accent-red)]'} icon="📐" />
   231|        <MetricCard title="Max Drawdown" value={`-${maxDD.maxDrawdown.toFixed(1)}%`} valueClass="text-[var(--accent-red)]" icon="📉" />
   232|        <MetricCard title="Net P&L" value={`$${totalPnl.toFixed(2)}`} valueClass={totalPnl >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'} icon="💰" />
   233|      </div>
   234|
   235|      {/* Equity Curve */}
   236|      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
   237|        <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">Equity Curve (30d)</h3>
   238|        {equityCurve.length > 1 ? (
   239|          <div className="relative h-32">
   240|            <svg viewBox={`0 0 ${equityCurve.length} 100`} className="w-full h-full" preserveAspectRatio="none">
   241|              <defs>
   242|                <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
   243|                  <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.3" />
   244|                  <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0" />
   245|                </linearGradient>
   246|              </defs>
   247|              {/* Fill area */}
   248|              <path
   249|                d={`M0,${100 - ((equityCurve[0] - minEquity) / rangeEquity) * 100} ${equityCurve.map((v, i) => `L${i},${100 - ((v - minEquity) / rangeEquity) * 100}`).join(' ')} L${equityCurve.length - 1},100 L0,100 Z`}
   250|                fill="url(#equityGrad)"
   251|              />
   252|              {/* Line */}
   253|              <polyline
   254|                points={equityCurve.map((v, i) => `${i},${100 - ((v - minEquity) / rangeEquity) * 100}`).join(' ')}
   255|                fill="none"
   256|                stroke="var(--accent-blue)"
   257|                strokeWidth="2"
   258|              />
   259|            </svg>
   260|            <div className="absolute bottom-1 right-2 text-xs text-[var(--text-muted)]">
   261|              ${maxEquity.toLocaleString('en-US', { maximumFractionDigits: 0 })}
   262|            </div>
   263|            <div className="absolute top-1 right-2 text-xs text-[var(--text-muted)]">
   264|              ${minEquity.toLocaleString('en-US', { maximumFractionDigits: 0 })}
   265|            </div>
   266|          </div>
   267|        ) : (
   268|          <div className="flex items-center justify-center h-32 text-[var(--text-muted)] text-sm">
   269|            No equity history available
   270|          </div>
   271|        )}
   272|      </div>
   273|
   274|      {/* Win/Loss Breakdown */}
   275|      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
   276|        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
   277|          <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">Win/Loss Breakdown</h3>
   278|          {trades.length > 0 ? (
   279|            <div className="space-y-3">
   280|              <div className="flex justify-between items-center">
   281|                <span className="text-sm text-[var(--accent-green)]">Avg Win</span>
   282|                <span className="text-sm font-bold text-[var(--accent-green)]">+${avgWin.toFixed(2)}</span>
   283|              </div>
   284|              <div className="w-full bg-[var(--bg-input)] rounded-full h-2">
   285|                <div className="bg-[var(--accent-green)] h-2 rounded-full" style={{ width: `${avgWin / (avgWin + avgLoss || 1) * 100}%` }} />
   286|              </div>
   287|              <div className="flex justify-between items-center">
   288|                <span className="text-sm text-[var(--accent-red)]">Avg Loss</span>
   289|                <span className="text-sm font-bold text-[var(--accent-red)]">-${avgLoss.toFixed(2)}</span>
   290|              </div>
   291|              <div className="w-full bg-[var(--bg-input)] rounded-full h-2">
   292|                <div className="bg-[var(--accent-red)] h-2 rounded-full" style={{ width: `${avgLoss / (avgWin + avgLoss || 1) * 100}%` }} />
   293|              </div>
   294|              <div className="pt-2 border-t border-[var(--border)] flex justify-between">
   295|                <span className="text-sm text-[var(--text-muted)]">Win/Loss Ratio</span>
   296|                <span className="text-sm font-bold text-white">{avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : '∞'}:1</span>
   297|              </div>
   298|            </div>
   299|          ) : (
   300|            <div className="text-[var(--text-muted)] text-sm text-center py-4">No closed trades yet</div>
   301|          )}
   302|        </div>
   303|
   304|        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
   305|          <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">Best & Worst Trades</h3>
   306|          {trades.length > 0 ? (
   307|            <div className="space-y-3">
   308|              {bestTrade && (
   309|                <div className="flex justify-between items-center p-2 bg-[var(--accent-green)]/5 rounded-lg border border-[var(--accent-green)]/20">
   310|                  <div>
   311|                    <span className="text-xs text-[var(--accent-green)]">🏆 Best</span>
   312|                    <div className="text-sm text-white font-medium">{bestTrade.symbol}</div>
   313|                  </div>
   314|                  <div className="text-right">
   315|                    <div className="text-sm font-bold text-[var(--accent-green)]">+${bestTrade.pnl.toFixed(2)}</div>
   316|                    <div className="text-xs text-[var(--accent-green)]">+{bestTrade.pnlPct.toFixed(1)}%</div>
   317|                  </div>
   318|                </div>
   319|              )}
   320|              {worstTrade && (
   321|                <div className="flex justify-between items-center p-2 bg-[var(--accent-red)]/5 rounded-lg border border-[var(--accent-red)]/20">
   322|                  <div>
   323|                    <span className="text-xs text-[var(--accent-red)]">💀 Worst</span>
   324|                    <div className="text-sm text-white font-medium">{worstTrade.symbol}</div>
   325|                  </div>
   326|                  <div className="text-right">
   327|                    <div className="text-sm font-bold text-[var(--accent-red)]">${worstTrade.pnl.toFixed(2)}</div>
   328|                    <div className="text-xs text-[var(--accent-red)]">{worstTrade.pnlPct.toFixed(1)}%</div>
   329|                  </div>
   330|                </div>
   331|              )}
   332|              <div className="pt-2 border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
   333|                Win streak: {calcStreak(trades, 'win')} | Loss streak: {calcStreak(trades, 'loss')}
   334|              </div>
   335|            </div>
   336|          ) : (
   337|            <div className="text-[var(--text-muted)] text-sm text-center py-4">No closed trades yet</div>
   338|          )}
   339|        </div>
   340|      </div>
   341|
   342|      {/* P&L by Period Heatmap */}
   343|      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
   344|        <div className="flex items-center justify-between mb-3">
   345|          <h3 className="text-sm font-medium text-[var(--text-muted)]">P&L by Period</h3>
   346|          <div className="flex bg-[var(--bg-input)] rounded-lg border border-[var(--border)] overflow-hidden">
   347|            {['daily', 'weekly', 'monthly'].map(p => (
   348|              <button
   349|                key={p}
   350|                onClick={() => setPeriodView(p)}
   351|                className={`px-3 py-1 text-xs font-medium transition-colors capitalize ${
   352|                  periodView === p ? 'bg-[var(--accent-blue)] text-white' : 'text-[var(--text-muted)] hover:text-white'
   353|                }`}
   354|              >
   355|                {p}
   356|              </button>
   357|            ))}
   358|          </div>
   359|        </div>
   360|        {pnlByPeriod.length > 0 ? (
   361|          <div className="space-y-1">
   362|            {pnlByPeriod.slice(-14).map(({ date, pnl }) => (
   363|              <div key={date} className="flex items-center gap-3">
   364|                <span className="text-xs text-[var(--text-muted)] w-24 shrink-0">{date}</span>
   365|                <div className="flex-1 h-5 bg-[var(--bg-input)] rounded overflow-hidden relative">
   366|                  <div
   367|                    className={`h-full rounded transition-all ${pnl >= 0 ? 'bg-[var(--accent-green)]/30' : 'bg-[var(--accent-red)]/30'}`}
   368|                    style={{
   369|                      width: `${Math.min(Math.abs(pnl) / (Math.max(...pnlByPeriod.map(p => Math.abs(p.pnl))) || 1) * 100, 100)}%`,
   370|                    }}
   371|                  />
   372|                </div>
   373|                <span className={`text-xs font-mono w-20 text-right ${pnl >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
   374|                  {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
   375|                </span>
   376|              </div>
   377|            ))}
   378|          </div>
   379|        ) : (
   380|          <div className="text-[var(--text-muted)] text-sm text-center py-4">No trade data for this period</div>
   381|        )}
   382|      </div>
   383|
   384|      {/* Trade Log */}
   385|      {trades.length > 0 && (
   386|        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
   387|          <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">Trade History ({trades.length} trades)</h3>
   388|          <div className="overflow-x-auto">
   389|            <table className="w-full text-sm">
   390|              <thead>
   391|                <tr className="text-[var(--text-muted)] border-b border-[var(--border)]">
   392|                  <th className="text-left py-2 px-2">Symbol</th>
   393|                  <th className="text-right py-2 px-2">Entry</th>
   394|                  <th className="text-right py-2 px-2">Exit</th>
   395|                  <th className="text-right py-2 px-2">Qty</th>
   396|                  <th className="text-right py-2 px-2">P&L</th>
   397|                  <th className="text-right py-2 px-2">P&L %</th>
   398|                  <th className="text-right py-2 px-2">Closed</th>
   399|                </tr>
   400|              </thead>
   401|              <tbody>
   402|                {trades.slice(-20).reverse().map((t, i) => (
   403|                  <tr key={i} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-input)]">
   404|                    <td className="py-2 px-2 text-white font-medium">{t.symbol}</td>
   405|                    <td className="py-2 px-2 text-right text-[var(--text-muted)]">${t.entryPrice.toFixed(2)}</td>
   406|                    <td className="py-2 px-2 text-right text-[var(--text-muted)]">${t.exitPrice.toFixed(2)}</td>
   407|                    <td className="py-2 px-2 text-right text-[var(--text-muted)]">{t.qty.toFixed(6)}</td>
   408|                    <td className={`py-2 px-2 text-right font-medium ${t.pnl >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
   409|                      {t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)}
   410|                    </td>
   411|                    <td className={`py-2 px-2 text-right ${t.pnlPct >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
   412|                      {t.pnlPct >= 0 ? '+' : ''}{t.pnlPct.toFixed(1)}%
   413|                    </td>
   414|                    <td className="py-2 px-2 text-right text-[var(--text-muted)] text-xs">
   415|                      {new Date(t.closeTime).toLocaleDateString()}
   416|                    </td>
   417|                  </tr>
   418|                ))}
   419|              </tbody>
   420|            </table>
   421|          </div>
   422|        </div>
   423|      )}
   424|    </div>
   425|  );
   426|}
   427|
   428|// Helper: Calculate current streak
   429|function calcStreak(trades, type) {
   430|  let max = 0, current = 0;
   431|  for (const t of trades) {
   432|    if ((type === 'win' && t.pnl > 0) || (type === 'loss' && t.pnl < 0)) {
   433|      current++;
   434|      max = Math.max(max, current);
   435|    } else {
   436|      current = 0;
   437|    }
   438|  }
   439|  return max;
   440|}
   441|
   442|// Metric card sub-component
   443|function MetricCard({ title, value, valueClass = 'text-white', icon }) {
   444|  return (
   445|    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-3 hover:border-[#448aff]/30 transition-colors">
   446|      <div className="flex items-start justify-between">
   447|        <div>
   448|          <p className="text-xs text-[var(--text-muted)] mb-1">{title}</p>
   449|          <p className={`text-xl font-bold ${valueClass}`}>{value}</p>
   450|        </div>
   451|        <span className="text-lg">{icon}</span>
   452|      </div>
   453|    </div>
   454|  );
   455|}