import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';

const CRYPTO_SYMBOLS = [
  { value: 'BTC/USD', label: 'BTC' },
  { value: 'ETH/USD', label: 'ETH' },
  { value: 'SOL/USD', label: 'SOL' },
  { value: 'DOGE/USD', label: 'DOGE' },
  { value: 'ADA/USD', label: 'ADA' },
  { value: 'XRP/USD', label: 'XRP' },
];

const PERIODS = [14, 21, 28];

function calcRSI(closes, period) {
  const rsi = [];
  if (closes.length < period + 1) return rsi;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return rsi;
}

export default function RSIChart() {
  const [symbol, setSymbol] = useState('BTC/USD');
  const [period, setPeriod] = useState(14);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchBars = async () => {
      setLoading(true);
      setError(null);
      try {
        const alpacaSymbol = symbol.replace('/', '');
        const end = new Date().toISOString();
        const start = new Date(Date.now() - 500 * 3600000).toISOString();
        const res = await fetch(`/api/crypto/us/bars?symbols=${alpacaSymbol}&timeframe=1Hour&limit=200&start=${start}&end=${end}`);
        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
        const json = await res.json();
        const bars = json?.bars?.[alpacaSymbol];
        if (!bars || bars.length === 0) { setError('No data'); setLoading(false); return; }

        const closes = bars.map(b => b.c || b.Close);
        const rsiValues = calcRSI(closes, period);
        const offset = closes.length - rsiValues.length;
        const chartData = rsiValues.map((val, i) => ({
          date: new Date(bars[offset + i]?.t || bars[offset + i]?.Timestamp || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit' }),
          rsi: parseFloat(val.toFixed(2)),
        }));
        setData(chartData);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    fetchBars();
  }, [symbol, period]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const val = payload[0].value;
      return (
        <div className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg p-3 shadow-xl">
          <p className="text-xs text-[var(--text-muted)]">{label}</p>
          <p className="text-sm font-bold text-white">RSI({period}): {val}</p>
          <p className={`text-xs ${val > 70 ? 'text-[var(--accent-red)]' : val < 30 ? 'text-[var(--accent-green)]' : 'text-[var(--text-muted)]'}`}>
            {val > 70 ? 'Overbought' : val < 30 ? 'Oversold' : 'Neutral'}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          {CRYPTO_SYMBOLS.map(s => (
            <button
              key={s.value}
              onClick={() => setSymbol(s.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                symbol === s.value
                  ? 'bg-[var(--accent-blue)] text-white'
                  : 'bg-[var(--bg-input)] text-[var(--text-muted)] hover:text-white'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-auto">
          {PERIODS.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                period === p
                  ? 'bg-[var(--accent-purple)] text-white'
                  : 'bg-[var(--bg-input)] text-[var(--text-muted)] hover:text-white'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="relative bg-[var(--bg-primary)] rounded-xl border border-[var(--border)] p-4">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)]/80 z-10 rounded-xl">
            <div className="animate-pulse text-[var(--text-muted)]">Calculating RSI...</div>
          </div>
        )}
        {error && !loading && (
          <div className="flex items-center justify-center h-48">
            <div className="text-[var(--accent-red)] text-sm">{error}</div>
          </div>
        )}
        {!loading && !error && data.length > 0 && (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
              <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} ticks={[0, 30, 50, 70, 100]} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceArea y1={70} y2={100} fill="var(--accent-red)" fillOpacity={0.13} />
              <ReferenceArea y1={0} y2={30} fill="var(--accent-green)" fillOpacity={0.13} />
              <ReferenceLine y={70} stroke="var(--accent-red)" strokeOpacity={0.4} strokeDasharray="3 3" />
              <ReferenceLine y={30} stroke="var(--accent-green)" strokeOpacity={0.4} strokeDasharray="3 3" />
              <ReferenceLine y={50} stroke="var(--text-muted)" strokeOpacity={0.13} strokeDasharray="3 3" />
              <Line type="monotone" dataKey="rsi" stroke="var(--accent-purple)" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
