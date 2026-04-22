import { useState, useEffect, useCallback } from 'react';

const SIGNAL_COLORS = {
  STRONG_BUY: { bg: 'bg-[#00c853]/20', text: 'text-[#00c853]', border: 'border-[#00c853]/30' },
  BUY: { bg: 'bg-[#00c853]/10', text: 'text-[#69f0ae]', border: 'border-[#00c853]/20' },
  NEUTRAL: { bg: 'bg-[#8b8fa3]/10', text: 'text-[#8b8fa3]', border: 'border-[#8b8fa3]/20' },
  SELL: { bg: 'bg-[#ff1744]/10', text: 'text-[#ff5252]', border: 'border-[#ff1744]/20' },
  STRONG_SELL: { bg: 'bg-[#ff1744]/20', text: 'text-[#ff1744]', border: 'border-[#ff1744]/30' },
  ERROR: { bg: 'bg-[#ff9100]/10', text: 'text-[#ff9100]', border: 'border-[#ff9100]/20' },
  NO_DATA: { bg: 'bg-[#8b8fa3]/10', text: 'text-[#8b8fa3]', border: 'border-[#8b8fa3]/20' },
};

function ScoreBar({ score, signal }) {
  const color = signal === 'STRONG_BUY' || signal === 'BUY' ? '#00c853'
    : signal === 'STRONG_SELL' || signal === 'SELL' ? '#ff1744'
    : '#8b8fa3';
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-[#252836] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs text-[#8b8fa3] w-8">{score}</span>
    </div>
  );
}

function SignalBadge({ signal }) {
  const style = SIGNAL_COLORS[signal] || SIGNAL_COLORS.NEUTRAL;
  const icons = { STRONG_BUY: '🔥', BUY: '📈', NEUTRAL: '➡️', SELL: '📉', STRONG_SELL: '🔻', ERROR: '⚠️', NO_DATA: '❓' };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${style.bg} ${style.text} ${style.border}`}>
      {icons[signal] || '➡️'} {signal}
    </span>
  );
}

export default function CryptoScanner() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastScan, setLastScan] = useState(null);
  const [sortField, setSortField] = useState('score');
  const [sortDir, setSortDir] = useState('desc');
  const [filterSignal, setFilterSignal] = useState('all');
  const [timeframe, setTimeframe] = useState('1H');

  const runScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/crypto-scanner?timeframe=${timeframe}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResults(data.scanResults || []);
      setLastScan(data.timestamp);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [timeframe]);

  useEffect(() => {
    runScan();
  }, [runScan]);

  const sorted = [...results].sort((a, b) => {
    const va = a[sortField] ?? 0;
    const vb = b[sortField] ?? 0;
    return sortDir === 'desc' ? vb - va : va - vb;
  });

  const filtered = filterSignal === 'all' ? sorted : sorted.filter(r => r.signal === filterSignal);
  const buyCount = results.filter(r => r.signal === 'BUY' || r.signal === 'STRONG_BUY').length;
  const sellCount = results.filter(r => r.signal === 'SELL' || r.signal === 'STRONG_SELL').length;

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const SortHeader = ({ field, label, align = 'left' }) => (
    <th
      className={`px-3 py-2 text-xs font-medium text-[#8b8fa3] cursor-pointer hover:text-white select-none ${align === 'right' ? 'text-right' : ''}`}
      onClick={() => handleSort(field)}
    >
      {label} {sortField === field ? (sortDir === 'desc' ? '↓' : '↑') : ''}
    </th>
  );

  if (loading && results.length === 0) {
    return (
      <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] p-8 text-center">
        <div className="animate-pulse text-2xl mb-3">🔍</div>
        <p className="text-[#8b8fa3]">Scanning crypto pairs...</p>
        <p className="text-xs text-[#8b8fa3] mt-1">Analyzing RSI, MACD, volume, and volatility across 15 pairs</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={runScan}
          disabled={loading}
          className="px-4 py-2 bg-[#448aff] text-white rounded-lg text-sm font-medium hover:bg-[#448aff]/80 transition-colors disabled:opacity-50"
        >
          {loading ? '🔄 Scanning...' : '🔍 Run Scan'}
        </button>

        <select
          value={timeframe}
          onChange={(e) => setTimeframe(e.target.value)}
          className="px-3 py-2 bg-[#252836] border border-[#2d3148] rounded-lg text-sm text-white"
        >
          <option value="15Min">15 Min</option>
          <option value="1H">1 Hour</option>
          <option value="4H">4 Hours</option>
          <option value="1D">Daily</option>
        </select>

        <select
          value={filterSignal}
          onChange={(e) => setFilterSignal(e.target.value)}
          className="px-3 py-2 bg-[#252836] border border-[#2d3148] rounded-lg text-sm text-white"
        >
          <option value="all">All Signals</option>
          <option value="STRONG_BUY">🔥 Strong Buy</option>
          <option value="BUY">📈 Buy</option>
          <option value="NEUTRAL">➡️ Neutral</option>
          <option value="SELL">📉 Sell</option>
          <option value="STRONG_SELL">🔻 Strong Sell</option>
        </select>

        {lastScan && (
          <span className="text-xs text-[#8b8fa3] ml-auto">
            Last scan: {new Date(lastScan).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Summary */}
      {results.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] p-3 text-center">
            <p className="text-xs text-[#8b8fa3]">Pairs Scanned</p>
            <p className="text-lg font-bold text-white">{results.length}</p>
          </div>
          <div className="bg-[#00c853]/5 rounded-xl border border-[#00c853]/20 p-3 text-center">
            <p className="text-xs text-[#00c853]">Buy Signals</p>
            <p className="text-lg font-bold text-[#00c853]">{buyCount}</p>
          </div>
          <div className="bg-[#ff1744]/5 rounded-xl border border-[#ff1744]/20 p-3 text-center">
            <p className="text-xs text-[#ff1744]">Sell Signals</p>
            <p className="text-lg font-bold text-[#ff1744]">{sellCount}</p>
          </div>
          <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] p-3 text-center">
            <p className="text-xs text-[#8b8fa3]">In Target Range</p>
            <p className="text-lg font-bold text-white">{results.filter(r => r.dailyTarget === 'YES').length}</p>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-[#ff1744]/10 border border-[#ff1744]/30 text-[#ff1744] px-4 py-2 rounded-lg text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* Results Table */}
      <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#252836]">
              <tr>
                <SortHeader field="pair" label="Pair" />
                <SortHeader field="signal" label="Signal" />
                <SortHeader field="price" label="Price" align="right" />
                <SortHeader field="change1h" label="1H %" align="right" />
                <SortHeader field="change24h" label="24H %" align="right" />
                <SortHeader field="rsi" label="RSI" align="right" />
                <SortHeader field="volumeRatio" label="Vol Ratio" align="right" />
                <SortHeader field="volatility" label="Vol %" align="right" />
                <SortHeader field="score" label="Score" />
                <th className="px-3 py-2 text-xs font-medium text-[#8b8fa3]">2-8% Target</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const change1h = parseFloat(r.change1h || 0);
                const change24h = parseFloat(r.change24h || 0);
                const rsiVal = parseFloat(r.rsi || 0);
                return (
                  <tr key={r.pair || i} className="border-t border-[#2d3148] hover:bg-[#252836]/50 transition-colors">
                    <td className="px-3 py-2 font-medium text-white">{r.pair?.replace('/USD', '/$')}</td>
                    <td className="px-3 py-2"><SignalBadge signal={r.signal} /></td>
                    <td className="px-3 py-2 text-right text-white font-mono">${typeof r.price === 'number' ? r.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: r.price > 100 ? 2 : 6 }) : '—'}</td>
                    <td className={`px-3 py-2 text-right font-mono ${change1h >= 0 ? 'text-[#00c853]' : 'text-[#ff1744]'}`}>
                      {change1h >= 0 ? '+' : ''}{r.change1h || '—'}%
                    </td>
                    <td className={`px-3 py-2 text-right font-mono ${change24h >= 0 ? 'text-[#00c853]' : 'text-[#ff1744]'}`}>
                      {change24h >= 0 ? '+' : ''}{r.change24h || '—'}%
                    </td>
                    <td className={`px-3 py-2 text-right font-mono ${
                      rsiVal < 30 ? 'text-[#448aff]' : rsiVal > 70 ? 'text-[#ff1744]' : 'text-white'
                    }`}>
                      {r.rsi || '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-white">{r.volumeRatio || '—'}x</td>
                    <td className="px-3 py-2 text-right font-mono text-white">{r.volatility || '—'}%</td>
                    <td className="px-3 py-2"><ScoreBar score={r.score || 0} signal={r.signal} /></td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        r.dailyTarget === 'YES' ? 'bg-[#00c853]/10 text-[#00c853]' : 'bg-[#ff1744]/10 text-[#ff1744]'
                      }`}>
                        {r.dailyTarget === 'YES' ? '✓ YES' : '✗ NO'}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-[#8b8fa3]">
                    No results. Click "Run Scan" to analyze crypto pairs.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Cards for Buy Signals */}
      {(filtered.filter(r => r.signal === 'BUY' || r.signal === 'STRONG_BUY')).length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-[#00c853]">🎯 Top Buy Candidates</h3>
          {filtered
            .filter(r => r.signal === 'BUY' || r.signal === 'STRONG_BUY')
            .slice(0, 5)
            .map(r => (
              <div key={r.pair} className="bg-[#1a1d29] rounded-xl border border-[#00c853]/20 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <SignalBadge signal={r.signal} />
                    <span className="font-bold text-white">{r.pair}</span>
                  </div>
                  <span className="text-lg font-bold text-white">${typeof r.price === 'number' ? r.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: r.price > 100 ? 2 : 6 }) : '—'}</span>
                </div>
                <p className="text-xs text-[#8b8fa3] mb-1">
                  Signals: <span className="text-white">{r.signals || '—'}</span>
                </p>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div>
                    <span className="text-[#8b8fa3]">RSI</span>
                    <p className={`font-mono ${parseFloat(r.rsi || 0) < 30 ? 'text-[#448aff]' : parseFloat(r.rsi || 0) > 70 ? 'text-[#ff1744]' : 'text-white'}`}>{r.rsi || '—'}</p>
                  </div>
                  <div>
                    <span className="text-[#8b8fa3]">Vol Ratio</span>
                    <p className="font-mono text-white">{r.volumeRatio || '—'}x</p>
                  </div>
                  <div>
                    <span className="text-[#8b8fa3]">Volatility</span>
                    <p className="font-mono text-white">{r.volatility || '—'}%</p>
                  </div>
                  <div>
                    <span className="text-[#8b8fa3]">Score</span>
                    <p className="font-mono text-[#00c853]">{r.score}/100</p>
                  </div>
                </div>
              </div>
            ))
          }
        </div>
      )}
    </div>
  );
}