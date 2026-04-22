import { useState, useEffect, useMemo } from 'react';
import {
  ComposedChart, Bar, Line, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid
} from 'recharts';
import { fetchCryptoBars } from '../api';

const SYMBOLS = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'DOGE/USD', 'LTC/USD', 'AVAX/USD', 'MATIC/USD', 'LINK/USD'];
const TIMEFRAMES = [
  { value: '1Hour', label: '1H' },
  { value: '4Hour', label: '4H' },
  { value: '1Day', label: '1D' },
];
const INDICATORS = ['RSI', 'MACD', 'Bollinger'];

// --- Technical indicator calculations ---
function calcSMA(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    result.push(sum / period);
  }
  return result;
}

function calcEMA(data, period) {
  const result = [];
  const k = 2 / (period + 1);
  let ema = null;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (ema === null) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j];
      ema = sum / period;
    } else {
      ema = data[i] * k + ema * (1 - k);
    }
    result.push(ema);
  }
  return result;
}

function calcRSI(closes, period = 14) {
  const result = [];
  const gains = [], losses = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  for (let i = 0; i < closes.length; i++) {
    if (i < period) { result.push(null); continue; }
    const idx = i - 1;
    if (idx < period - 1) { result.push(null); continue; }
    let avgGain = 0, avgLoss = 0;
    for (let j = idx - period + 2; j <= idx; j++) {
      avgGain += gains[j];
      avgLoss += losses[j];
    }
    avgGain /= period;
    avgLoss /= period;
    if (avgLoss === 0) { result.push(100); continue; }
    const rs = avgGain / avgLoss;
    result.push(100 - (100 / (1 + rs)));
  }
  return result;
}

function calcMACD(closes) {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine = ema12.map((v, i) => {
    if (v === null || ema26[i] === null) return null;
    return v - ema26[i];
  });
  const validMacd = macdLine.filter(v => v !== null);
  const signal = calcEMA(validMacd, 9);
  // Re-align signal to full array
  const signalFull = [];
  let sigIdx = 0;
  const offset = macdLine.findIndex(v => v !== null);
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] === null || sigIdx >= signal.length) {
      signalFull.push(null);
    } else {
      signalFull.push(signal[sigIdx]);
      sigIdx++;
    }
  }
  const histogram = macdLine.map((v, i) => {
    if (v === null || signalFull[i] === null) return null;
    return v - signalFull[i];
  });
  return { macdLine, signalLine: signalFull, histogram };
}

function calcBollinger(closes, period = 20, stdDev = 2) {
  const sma = calcSMA(closes, period);
  const upper = [], lower = [];
  for (let i = 0; i < closes.length; i++) {
    if (sma[i] === null) { upper.push(null); lower.push(null); continue; }
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += (closes[j] - sma[i]) ** 2;
    }
    const std = Math.sqrt(sumSq / period);
    upper.push(sma[i] + stdDev * std);
    lower.push(sma[i] - stdDev * std);
  }
  return { upper, middle: sma, lower };
}

// --- Candlestick shape ---
const Candlestick = (props) => {
  const { x, y, width, height, payload } = props;
  if (!payload) return null;
  const { open, high, low, close } = payload;
  if (open == null || close == null) return null;

  const isUp = close >= open;
  const color = isUp ? '#00c853' : '#ff1744';
  const bodyTop = Math.min(open, close);
  const bodyBot = Math.max(open, close);

  // yScale maps price to pixel: we derive from the parent chart's y-axis
  // Since recharts passes y/height for the bar reference, we need to compute positions
  // from the actual data range. Instead, we use a custom approach:
  // We'll render using the raw props from the chart
  return null; // We use Bar with custom shape below
};

// Custom candlestick shape for recharts Bar
function CandlestickShape(props) {
  const { x, y, width, payload, yAxis } = props;
  if (!payload || payload.open == null || payload.close == null) return null;

  // Get the y-scale from yAxis
  const scale = yAxis?.scale;
  if (!scale) return null;

  const { open, high, low, close } = payload;
  const isUp = close >= open;
  const color = isUp ? '#00c853' : '#ff1744';
  const bodyColor = isUp ? '#00c85340' : '#ff174440';
  const bodyTop = Math.min(open, close);
  const bodyBot = Math.max(open, close);

  const yHigh = scale(high);
  const yLow = scale(low);
  const yBodyTop = scale(bodyTop);
  const yBodyBot = scale(bodyBot);

  const cx = x + width / 2;
  const bodyWidth = Math.max(width * 0.6, 2);

  return (
    <g>
      {/* Wick */}
      <line x1={cx} y1={yHigh} x2={cx} y2={yLow} stroke={color} strokeWidth={1} />
      {/* Body */}
      <rect
        x={cx - bodyWidth / 2}
        y={yBodyTop}
        width={bodyWidth}
        height={Math.max(yBodyBot - yBodyTop, 1)}
        fill={bodyColor}
        stroke={color}
        strokeWidth={1}
      />
    </g>
  );
}

// Custom tooltip
function ChartTooltip({ active, payload, label, indicators }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  return (
    <div className="bg-[#252836] border border-[#2d3148] rounded-lg p-3 shadow-xl text-xs">
      <p className="text-[#8b8fa3] mb-1">{d.dateLabel}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span className="text-[#8b8fa3]">Open:</span><span className="text-white">{d.open?.toFixed(2)}</span>
        <span className="text-[#8b8fa3]">High:</span><span className="text-white">{d.high?.toFixed(2)}</span>
        <span className="text-[#8b8fa3]">Low:</span><span className="text-white">{d.low?.toFixed(2)}</span>
        <span className="text-[#8b8fa3]">Close:</span>
        <span className={d.close >= d.open ? 'text-[#00c853]' : 'text-[#ff1744]'}>
          {d.close?.toFixed(2)}
        </span>
        <span className="text-[#8b8fa3]">Vol:</span><span className="text-white">{(d.volume || 0).toLocaleString()}</span>
      </div>
      {indicators.includes('RSI') && d.rsi != null && (
        <div className="mt-1 pt-1 border-t border-[#2d3148]">
          <span className="text-[#ab47bc]">RSI(14):</span> <span className="text-white">{d.rsi.toFixed(1)}</span>
        </div>
      )}
      {indicators.includes('MACD') && d.macd != null && (
        <div className="mt-1 pt-1 border-t border-[#2d3148]">
          <span className="text-[#2979ff]">MACD:</span> <span className="text-white">{d.macd.toFixed(2)}</span>
          &nbsp;<span className="text-[#ff6d00]">Signal:</span> <span className="text-white">{d.signal?.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

function RsiTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d || d.rsi == null) return null;
  const color = d.rsi > 70 ? '#ff1744' : d.rsi < 30 ? '#00c853' : '#ab47bc';
  return (
    <div className="bg-[#252836] border border-[#2d3148] rounded-lg px-3 py-1 shadow-xl text-xs">
      <span className="text-[#8b8fa3]">RSI:</span> <span style={{ color }}>{d.rsi.toFixed(1)}</span>
    </div>
  );
}

function MacdTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d || d.macd == null) return null;
  return (
    <div className="bg-[#252836] border border-[#2d3148] rounded-lg px-3 py-1 shadow-xl text-xs">
      <span className="text-[#2979ff]">MACD:</span> <span className="text-white">{d.macd.toFixed(2)}</span>
      &nbsp;<span className="text-[#ff6d00]">Sig:</span> <span className="text-white">{d.signal?.toFixed(2)}</span>
      &nbsp;<span className="text-[#8b8fa3]">Hist:</span> <span className="text-white">{d.histogram?.toFixed(2)}</span>
    </div>
  );
}

export default function AdvancedChart() {
  const [symbol, setSymbol] = useState('BTC/USD');
  const [timeframe, setTimeframe] = useState('1Hour');
  const [indicators, setIndicators] = useState(['RSI']);
  const [bars, setBars] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [yDomain, setYDomain] = useState([0, 100]);

  const loadBars = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCryptoBars(symbol.replace('/', ''), timeframe, 100);
      // Alpaca returns { bars: { "BTC/USD": [...] } } or { bars: [...] }
      let barList = [];
      if (data.bars) {
        const key = Object.keys(data.bars)[0];
        barList = data.bars[key] || data.bars;
      }
      setBars(barList);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadBars(); }, [symbol, timeframe]);

  // Process bars + compute indicators
  const chartData = useMemo(() => {
    if (!bars || bars.length === 0) return [];

    const closes = bars.map(b => parseFloat(b.c || b.close || 0));
    const rsi = indicators.includes('RSI') ? calcRSI(closes) : [];
    const macd = indicators.includes('MACD') ? calcMACD(closes) : { macdLine: [], signalLine: [], histogram: [] };
    const bb = indicators.includes('Bollinger') ? calcBollinger(closes) : { upper: [], middle: [], lower: [] };

    return bars.map((b, i) => {
      const ts = b.t || b.timestamp;
      const dateLabel = timeframe === '1Day'
        ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      return {
        dateLabel,
        open: parseFloat(b.o || b.open || 0),
        high: parseFloat(b.h || b.high || 0),
        low: parseFloat(b.l || b.low || 0),
        close: parseFloat(b.c || b.close || 0),
        volume: parseInt(b.v || b.volume || 0),
        // For bar chart display (close vs open diff)
        body: parseFloat(b.c || b.close || 0) - parseFloat(b.o || b.open || 0),
        // Indicator values
        rsi: rsi[i] ?? null,
        macd: macd.macdLine[i] ?? null,
        signal: macd.signalLine[i] ?? null,
        histogram: macd.histogram[i] ?? null,
        bbUpper: bb.upper[i] ?? null,
        bbMiddle: bb.middle[i] ?? null,
        bbLower: bb.lower[i] ?? null,
        // For rendering candlestick body using recharts Bar hack
        candleHigh: parseFloat(b.h || b.high || 0),
        candleLow: parseFloat(b.l || b.low || 0),
      };
    });
  }, [bars, indicators, timeframe]);

  // Price domain
  const priceDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 100];
    let min = Infinity, max = -Infinity;
    chartData.forEach(d => {
      if (d.low < min) min = d.low;
      if (d.high > max) max = d.high;
      // Expand for Bollinger
      if (d.bbUpper != null && d.bbUpper > max) max = d.bbUpper;
      if (d.bbLower != null && d.bbLower < min) min = d.bbLower;
    });
    const pad = (max - min) * 0.05;
    return [min - pad, max + pad];
  }, [chartData]);

  const toggleIndicator = (ind) => {
    setIndicators(prev =>
      prev.includes(ind) ? prev.filter(i => i !== ind) : [...prev, ind]
    );
  };

  const showRSI = indicators.includes('RSI');
  const showMACD = indicators.includes('MACD');
  const showBB = indicators.includes('Bollinger');

  // Price chart height varies based on sub-panels
  const mainChartHeight = showRSI && showMACD ? 200 : showRSI || showMACD ? 260 : 320;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={symbol}
          onChange={e => setSymbol(e.target.value)}
          className="px-3 py-1.5 bg-[#252836] border border-[#2d3148] rounded-lg text-sm text-white focus:outline-none focus:border-[#448aff]"
        >
          {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <div className="flex bg-[#252836] rounded-lg border border-[#2d3148] overflow-hidden">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.value}
              onClick={() => setTimeframe(tf.value)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                timeframe === tf.value
                  ? 'bg-[#448aff] text-white'
                  : 'text-[#8b8fa3] hover:text-white'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          {INDICATORS.map(ind => (
            <button
              key={ind}
              onClick={() => toggleIndicator(ind)}
              className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                indicators.includes(ind)
                  ? ind === 'RSI' ? 'bg-[#ab47bc]/20 border-[#ab47bc]/40 text-[#ab47bc]'
                    : ind === 'MACD' ? 'bg-[#2979ff]/20 border-[#2979ff]/40 text-[#2979ff]'
                    : 'bg-[#00bcd4]/20 border-[#00bcd4]/40 text-[#00bcd4]'
                  : 'bg-[#252836] border-[#2d3148] text-[#8b8fa3] hover:text-white'
              }`}
            >
              {ind}
            </button>
          ))}
        </div>

        <button
          onClick={loadBars}
          disabled={loading}
          className="px-3 py-1.5 bg-[#252836] hover:bg-[#2d3148] rounded-lg text-sm transition-colors border border-[#2d3148] text-[#8b8fa3] hover:text-white"
        >
          {loading ? '...' : '↻'}
        </button>
      </div>

      {error && (
        <div className="bg-[#ff1744]/10 border border-[#ff1744]/30 text-[#ff1744] px-4 py-2 rounded-lg text-sm">
          {error}
        </div>
      )}

      {loading && !bars && (
        <div className="flex items-center justify-center h-48 text-[#8b8fa3]">Loading chart data...</div>
      )}

      {chartData.length > 0 && (
        <div className="space-y-0">
          {/* Main price chart */}
          <div className="bg-[#1a1d29] rounded-t-xl border border-[#2d3148] border-b-0 p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-white">
                {symbol} — {timeframe}
              </h3>
              <div className="flex gap-3 text-xs text-[#8b8fa3]">
                {showBB && (
                  <>
                    <span className="text-[#00bcd4]">━ BB Upper</span>
                    <span className="text-[#00bcd4]/60">━ BB Mid</span>
                    <span className="text-[#00bcd4]">━ BB Lower</span>
                  </>
                )}
                <span className="text-[#00c853]">● Bullish</span>
                <span className="text-[#ff1744]">● Bearish</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={mainChartHeight}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2235" />
                <XAxis
                  dataKey="dateLabel"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#8b8fa3', fontSize: 10 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={priceDomain}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#8b8fa3', fontSize: 10 }}
                  tickFormatter={v => {
                    if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
                    return `$${v.toFixed(0)}`;
                  }}
                  yAxisId="price"
                />
                <Tooltip content={<ChartTooltip indicators={indicators} />} />
                {/* Candlestick wicks - thin bars from low to high */}
                <Bar
                  dataKey="candleLow"
                  yAxisId="price"
                  barSize={timeframe === '1Day' ? 12 : 4}
                  fill="transparent"
                  shape={(props) => {
                    const { x, width, payload } = props;
                    if (!payload || payload.candleHigh == null) return null;
                    // We draw candlesticks manually using the full y-scale
                    return null; // placeholder, real rendering below
                  }}
                />
                {/* Use custom shape for candlesticks via body bar */}
                <Bar
                  dataKey="close"
                  yAxisId="price"
                  barSize={timeframe === '1Day' ? 12 : 6}
                  fill="transparent"
                  shape={(props) => {
                    const { x, y, width, height, payload, background } = props;
                    if (!payload || payload.open == null || payload.close == null) return null;

                    const isUp = payload.close >= payload.open;
                    const color = isUp ? '#00c853' : '#ff1744';
                    const fillColor = isUp ? '#00c85340' : '#ff174440';

                    // Calculate pixel positions using yAxis
                    const yScale = props.yAxis;
                    if (!yScale) return null;

                    const yHigh = yScale.scale(payload.high);
                    const yLow = yScale.scale(payload.low);
                    const yOpen = yScale.scale(payload.open);
                    const yClose = yScale.scale(payload.close);

                    const cx = x + width / 2;
                    const bodyW = Math.max(width * 0.65, 2);
                    const bodyTop = Math.min(yOpen, yClose);
                    const bodyH = Math.max(Math.abs(yOpen - yClose), 1);

                    return (
                      <g>
                        {/* Wick (high-low line) */}
                        <line x1={cx} y1={yHigh} x2={cx} y2={yLow} stroke={color} strokeWidth={1} />
                        {/* Body */}
                        <rect
                          x={cx - bodyW / 2}
                          y={bodyTop}
                          width={bodyW}
                          height={bodyH}
                          fill={fillColor}
                          stroke={color}
                          strokeWidth={1}
                        />
                      </g>
                    );
                  }}
                />
                {/* Bollinger Bands */}
                {showBB && (
                  <>
                    <Line
                      type="monotone" dataKey="bbUpper" yAxisId="price"
                      stroke="#00bcd4" strokeWidth={1} dot={false}
                      strokeDasharray="4 2"
                    />
                    <Line
                      type="monotone" dataKey="bbMiddle" yAxisId="price"
                      stroke="#00bcd460" strokeWidth={1} dot={false}
                    />
                    <Line
                      type="monotone" dataKey="bbLower" yAxisId="price"
                      stroke="#00bcd4" strokeWidth={1} dot={false}
                      strokeDasharray="4 2"
                    />
                  </>
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* RSI Sub-panel */}
          {showRSI && (
            <div className="bg-[#1a1d29] border border-[#2d3148] border-t-0 p-4">
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-xs font-medium text-[#ab47bc]">RSI (14)</h4>
                <div className="flex gap-2 text-[10px] text-[#8b8fa3]">
                  <span>Overbought 70</span>
                  <span>Oversold 30</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={80}>
                <ComposedChart data={chartData} margin={{ top: 2, right: 5, bottom: 2, left: 5 }}>
                  <XAxis dataKey="dateLabel" hide />
                  <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: '#8b8fa3', fontSize: 9 }} />
                  <Tooltip content={<RsiTooltip />} />
                  <ReferenceLine y={70} stroke="#ff174440" strokeDasharray="3 3" />
                  <ReferenceLine y={30} stroke="#00c85340" strokeDasharray="3 3" />
                  <ReferenceLine y={50} stroke="#2d3148" />
                  <Area
                    type="monotone" dataKey="rsi"
                    stroke="#ab47bc" fill="#ab47bc15" strokeWidth={1.5} dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* MACD Sub-panel */}
          {showMACD && (
            <div className={`bg-[#1a1d29] border border-[#2d3148] border-t-0 p-4 ${!showRSI ? 'rounded-b-xl' : ''}`}>
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-xs font-medium">
                  <span className="text-[#2979ff]">MACD</span>
                  <span className="text-[#8b8fa3] mx-1">|</span>
                  <span className="text-[#ff6d00]">Signal</span>
                  <span className="text-[#8b8fa3] mx-1">|</span>
                  <span className="text-[#8b8fa3]">Histogram</span>
                </h4>
              </div>
              <ResponsiveContainer width="100%" height={80}>
                <ComposedChart data={chartData} margin={{ top: 2, right: 5, bottom: 2, left: 5 }}>
                  <XAxis dataKey="dateLabel" hide />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#8b8fa3', fontSize: 9 }} />
                  <Tooltip content={<MacdTooltip />} />
                  <ReferenceLine y={0} stroke="#2d3148" />
                  <Bar
                    dataKey="histogram"
                    fill={(entry) => entry.histogram >= 0 ? '#00c85380' : '#ff174480'}
                    barSize={timeframe === '1Day' ? 8 : 3}
                  />
                  <Line
                    type="monotone" dataKey="macd"
                    stroke="#2979ff" strokeWidth={1.5} dot={false}
                  />
                  <Line
                    type="monotone" dataKey="signal"
                    stroke="#ff6d00" strokeWidth={1.5} dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Bottom border for last panel */}
          {(!showRSI && !showMACD) && (
            <div className="bg-[#1a1d29] rounded-b-xl border border-[#2d3148] border-t-0 h-0" />
          )}
          {showRSI && !showMACD && (
            <div className="bg-[#1a1d29] rounded-b-xl border border-[#2d3148] border-t-0 h-0" />
          )}
          {showRSI && showMACD && (
            <div className="bg-[#1a1d29] rounded-b-xl border border-[#2d3148] border-t-0 h-0" />
          )}
        </div>
      )}

      {chartData.length === 0 && !loading && !error && (
        <div className="flex items-center justify-center h-48 text-[#8b8fa3]">
          No chart data available for {symbol}
        </div>
      )}
    </div>
  );
}