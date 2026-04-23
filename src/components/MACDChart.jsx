import { useState, useEffect } from 'react';
import { ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

const CRYPTO_SYMBOLS = [
  { value: 'BTC/USD', label: 'BTC' },
  { value: 'ETH/USD', label: 'ETH' },
  { value: 'SOL/USD', label: 'SOL' },
  { value: 'DOGE/USD', label: 'DOGE' },
  { value: 'ADA/USD', label: 'ADA' },
  { value: 'XRP/USD', label: 'XRP' },
];

function ema(data, period) {
  const result = [];
  if (data.length < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  result.push(sum / period);
  const k = 2 / (period + 1);
  for (let i = period; i < data.length; i++) {
    result.push(data[i] * k + result[result.length - 1] * (1 - k));
  }
  return result;
}

function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  if (emaFast.length === 0 || emaSlow.length === 0) return [];
  const offset = slow - fast;
  const macdLine = [];
  for (let i = 0; i < emaSlow.length; i++) {
    macdLine.push(emaFast[i + offset] - emaSlow[i]);
  }
  const signalLine = ema(macdLine, signal);
  const signalOffset = macdLine.length - signalLine.length;
  const histogram = signalLine.map((s, i) => ({
    macd: macdLine[i + signalOffset],
    signal: s,
    histogram: macdLine[i + signalOffset] - s,
  }));
  return histogram;
}

export default function MACDChart() {
  const [symbol, setSymbol] = useState('BTC/USD');
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
        const macdData = calcMACD(closes);
        if (macdData.length === 0) { setError('Not enough data for MACD'); setLoading(false); return; }

        const startIdx = closes.length - macdData.length;
        const chartData = macdData.map((d, i) => ({
          date: new Date(bars[startIdx + i]?.t || bars[startIdx + i]?.Timestamp || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit' }),
          macd: parseFloat(d.macd.toFixed(4)),
          signal: parseFloat(d.signal.toFixed(4)),
          histogram: parseFloat(d.histogram.toFixed(4)),
        }));
        setData(chartData);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    fetchBars();
  }, [symbol]);

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const vals = {};
      payload.forEach(p => vals[p.dataKey] = p.value);
      return (
        <div className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg p-3 shadow-xl">
          <p className="text-xs text-[var(--text-muted)]">{label}</p>
          <p className="text-sm text-[var(--accent-blue)]">MACD: {vals.macd?.toFixed(4)}</p>
          <p className="text-sm text-[#ff9800]">Signal: {vals.signal?.toFixed(4)}</p>
          <p className={`text-sm ${vals.histogram >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
            Hist: {vals.histogram?.toFixed(4)}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-3">
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
        <span className="ml-auto text-xs text-[var(--text-muted)]">MACD(12,26,9)</span>
      </div>

      <div className="relative bg-[var(--bg-primary)] rounded-xl border border-[var(--border)] p-4">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)]/80 z-10 rounded-xl">
            <div className="animate-pulse text-[var(--text-muted)]">Calculating MACD...</div>
          </div>
        )}
        {error && !loading && (
          <div className="flex items-center justify-center h-48">
            <div className="text-[var(--accent-red)] text-sm">{error}</div>
          </div>
        )}
        {!loading && !error && data.length > 0 && (
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0} stroke="#8b8fa333" />
              <Bar dataKey="histogram" fill="#00c85388" />
              <Line type="monotone" dataKey="macd" stroke="#448aff" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="signal" stroke="#ff9800" strokeWidth={1.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
