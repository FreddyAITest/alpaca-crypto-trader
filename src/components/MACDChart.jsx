     1|import { useState, useEffect } from 'react';
     2|import { ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
     3|
     4|const CRYPTO_SYMBOLS = [
     5|  { value: 'BTC/USD', label: 'BTC' },
     6|  { value: 'ETH/USD', label: 'ETH' },
     7|  { value: 'SOL/USD', label: 'SOL' },
     8|  { value: 'DOGE/USD', label: 'DOGE' },
     9|  { value: 'ADA/USD', label: 'ADA' },
    10|  { value: 'XRP/USD', label: 'XRP' },
    11|];
    12|
    13|function ema(data, period) {
    14|  const result = [];
    15|  if (data.length < period) return result;
    16|  let sum = 0;
    17|  for (let i = 0; i < period; i++) sum += data[i];
    18|  result.push(sum / period);
    19|  const k = 2 / (period + 1);
    20|  for (let i = period; i < data.length; i++) {
    21|    result.push(data[i] * k + result[result.length - 1] * (1 - k));
    22|  }
    23|  return result;
    24|}
    25|
    26|function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
    27|  const emaFast = ema(closes, fast);
    28|  const emaSlow = ema(closes, slow);
    29|  if (emaFast.length === 0 || emaSlow.length === 0) return [];
    30|  const offset = slow - fast;
    31|  const macdLine = [];
    32|  for (let i = 0; i < emaSlow.length; i++) {
    33|    macdLine.push(emaFast[i + offset] - emaSlow[i]);
    34|  }
    35|  const signalLine = ema(macdLine, signal);
    36|  const signalOffset = macdLine.length - signalLine.length;
    37|  const histogram = signalLine.map((s, i) => ({
    38|    macd: macdLine[i + signalOffset],
    39|    signal: s,
    40|    histogram: macdLine[i + signalOffset] - s,
    41|  }));
    42|  return histogram;
    43|}
    44|
    45|export default function MACDChart() {
    46|  const [symbol, setSymbol] = useState('BTC/USD');
    47|  const [data, setData] = useState([]);
    48|  const [loading, setLoading] = useState(false);
    49|  const [error, setError] = useState(null);
    50|
    51|  useEffect(() => {
    52|    const fetchBars = async () => {
    53|      setLoading(true);
    54|      setError(null);
    55|      try {
    56|        const alpacaSymbol = symbol.replace('/', '');
    57|        const end = new Date().toISOString();
    58|        const start = new Date(Date.now() - 500 * 3600000).toISOString();
    59|        const res = await fetch(`/api/crypto/us/bars?symbols=${alpacaSymbol}&timeframe=1Hour&limit=200&start=${start}&end=${end}`);
    60|        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    61|        const json = await res.json();
    62|        const bars = json?.bars?.[alpacaSymbol];
    63|        if (!bars || bars.length === 0) { setError('No data'); setLoading(false); return; }
    64|
    65|        const closes = bars.map(b => b.c || b.Close);
    66|        const macdData = calcMACD(closes);
    67|        if (macdData.length === 0) { setError('Not enough data for MACD'); setLoading(false); return; }
    68|
    69|        const startIdx = closes.length - macdData.length;
    70|        const chartData = macdData.map((d, i) => ({
    71|          date: new Date(bars[startIdx + i]?.t || bars[startIdx + i]?.Timestamp || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit' }),
    72|          macd: parseFloat(d.macd.toFixed(4)),
    73|          signal: parseFloat(d.signal.toFixed(4)),
    74|          histogram: parseFloat(d.histogram.toFixed(4)),
    75|        }));
    76|        setData(chartData);
    77|      } catch (e) {
    78|        setError(e.message);
    79|      } finally {
    80|        setLoading(false);
    81|      }
    82|    };
    83|    fetchBars();
    84|  }, [symbol]);
    85|
    86|  const CustomTooltip = ({ active, payload, label }) => {
    87|    if (active && payload && payload.length) {
    88|      const vals = {};
    89|      payload.forEach(p => vals[p.dataKey] = p.value);
    90|      return (
    91|        <div className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg p-3 shadow-xl">
    92|          <p className="text-xs text-[var(--text-muted)]">{label}</p>
    93|          <p className="text-sm text-[var(--accent-blue)]">MACD: {vals.macd?.toFixed(4)}</p>
    94|          <p className="text-sm text-[var(--accent-orange)]">Signal: {vals.signal?.toFixed(4)}</p>
    95|          <p className={`text-sm ${vals.histogram >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
    96|            Hist: {vals.histogram?.toFixed(4)}
    97|          </p>
    98|        </div>
    99|      );
   100|    }
   101|    return null;
   102|  };
   103|
   104|  return (
   105|    <div className="space-y-3">
   106|      <div className="flex items-center gap-1">
   107|        {CRYPTO_SYMBOLS.map(s => (
   108|          <button
   109|            key={s.value}
   110|            onClick={() => setSymbol(s.value)}
   111|            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
   112|              symbol === s.value
   113|                ? 'bg-[var(--accent-blue)] text-white'
   114|                : 'bg-[var(--bg-input)] text-[var(--text-muted)] hover:text-white'
   115|            }`}
   116|          >
   117|            {s.label}
   118|          </button>
   119|        ))}
   120|        <span className="ml-auto text-xs text-[var(--text-muted)]">MACD(12,26,9)</span>
   121|      </div>
   122|
   123|      <div className="relative bg-[var(--bg-primary)] rounded-xl border border-[var(--border)] p-4">
   124|        {loading && (
   125|          <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)]/80 z-10 rounded-xl">
   126|            <div className="animate-pulse text-[var(--text-muted)]">Calculating MACD...</div>
   127|          </div>
   128|        )}
   129|        {error && !loading && (
   130|          <div className="flex items-center justify-center h-48">
   131|            <div className="text-[var(--accent-red)] text-sm">{error}</div>
   132|          </div>
   133|        )}
   134|        {!loading && !error && data.length > 0 && (
   135|          <ResponsiveContainer width="100%" height={200}>
   136|            <ComposedChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
   137|              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
   138|              <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
   139|              <Tooltip content={<CustomTooltip />} />
   140|              <ReferenceLine y={0} stroke="var(--text-muted)" strokeOpacity={0.2} />
   141|              <Bar dataKey="histogram" fill="var(--accent-green)" fillOpacity={0.53} />
   142|              <Line type="monotone" dataKey="macd" stroke="var(--accent-blue)" strokeWidth={1.5} dot={false} />
   143|              <Line type="monotone" dataKey="signal" stroke="var(--accent-orange)" strokeWidth={1.5} dot={false} />
   144|            </ComposedChart>
   145|          </ResponsiveContainer>
   146|        )}
   147|      </div>
   148|    </div>
   149|  );
   150|}
   151|