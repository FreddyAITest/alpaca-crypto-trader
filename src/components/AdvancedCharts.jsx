import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchCryptoBars } from '../api';

const PAIRS = [
  'BTC/USD', 'ETH/USD', 'SOL/USD', 'AVAX/USD',
  'DOGE/USD', 'XRP/USD', 'ADA/USD', 'LINK/USD',
  'DOT/USD', 'LTC/USD', 'MATIC/USD', 'UNI/USD',
];

const TIMEFRAMES = [
  { value: '15Min', label: '15m' },
  { value: '1Hour', label: '1H' },
  { value: '4Hour', label: '4H' },
  { value: '1Day', label: '1D' },
];

// Technical indicator calculations
function ema(data, period) {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const result = new Array(data.length).fill(null);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  result[period - 1] = sum / period;
  for (let i = period; i < data.length; i++) {
    result[i] = data[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

function calcRsi(closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] >= 0) avgGain += changes[i];
    else avgLoss -= changes[i];
  }
  avgGain /= period;
  avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period; i < changes.length; i++) {
    const g = changes[i] >= 0 ? changes[i] : 0;
    const l = changes[i] < 0 ? -changes[i] : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    result[i + 1] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

function calcMacd(closes, fast = 12, slow = 26, signal = 9) {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const macdLine = fastEma.map((f, i) => (f !== null && slowEma[i] !== null) ? f - slowEma[i] : null);
  const validMacd = macdLine.filter(v => v !== null);
  const signalLine = ema(validMacd, signal);
  const offset = slow - 1;
  const fullSignal = new Array(closes.length).fill(null);
  for (let i = 0; i < signalLine.length; i++) {
    if (signalLine[i] !== null) fullSignal[i + offset] = signalLine[i];
  }
  const hist = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    if (macdLine[i] !== null && fullSignal[i] !== null) hist[i] = macdLine[i] - fullSignal[i];
  }
  return { macdLine, signalLine: fullSignal, histogram: hist };
}

function calcBollinger(closes, period = 20, mult = 2) {
  const mid = [];
  const upper = [];
  const lower = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { mid.push(null); upper.push(null); lower.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    const avg = sum / period;
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) sqSum += (closes[j] - avg) ** 2;
    const std = Math.sqrt(sqSum / period);
    mid.push(avg);
    upper.push(avg + mult * std);
    lower.push(avg - mult * std);
  }
  return { mid, upper, lower };
}

export default function AdvancedCharts() {
  const [pair, setPair] = useState('BTC/USD');
  const [timeframe, setTimeframe] = useState('1Hour');
  const [bars, setBars] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showRSI, setShowRSI] = useState(true);
  const [showMACD, setShowMACD] = useState(true);
  const [showBollinger, setShowBollinger] = useState(true);

  const candlestickRef = useRef(null);
  const rsiRef = useRef(null);
  const macdRef = useRef(null);
  const chartsRef = useRef([]);

  const loadBars = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const symbol = pair.replace('/', '');
      const data = await fetchCryptoBars(symbol, timeframe, 200);
      const barData = data?.bars?.[symbol];
      if (!barData || barData.length < 20) {
        setError('Insufficient bar data for this pair/timeframe');
        setBars([]);
        return;
      }
      setBars(barData);
    } catch (e) {
      setError(e.message);
      setBars([]);
    } finally {
      setLoading(false);
    }
  }, [pair, timeframe]);

  useEffect(() => { loadBars(); }, [loadBars]);

  // Cleanup chart instances on unmount or re-render
  useEffect(() => {
    return () => {
      chartsRef.current.forEach(c => c.remove());
      chartsRef.current = [];
    };
  }, []);

  // Render charts when bars change
  useEffect(() => {
    if (!bars || bars.length === 0) return;

    // Cleanup old charts
    chartsRef.current.forEach(c => c.remove());
    chartsRef.current = [];

    const closes = bars.map(b => b.c);
    const rsiData = calcRsi(closes);
    const macdResult = calcMacd(closes);
    const bollinger = calcBollinger(closes);

    const candleEl = candlestickRef.current;
    const rsiEl = rsiRef.current;
    const macdEl = macdRef.current;
    if (candleEl) candleEl.innerHTML = '';
    if (rsiEl) rsiEl.innerHTML = '';
    if (macdEl) macdEl.innerHTML = '';

    const chartTheme = {
      layout: {
        background: { type: 'solid', color: '#1a1d29' },
        textColor: '#8b8fa3',
      },
      grid: {
        vertLines: { color: '#2d3148' },
        horzLines: { color: '#2d3148' },
      },
      crosshair: {
        vertLine: { color: '#448aff44', labelBackgroundColor: '#448aff' },
        horzLine: { color: '#448aff44', labelBackgroundColor: '#448aff' },
      },
      timeScale: {
        borderColor: '#2d3148',
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: '#2d3148',
      },
    };

    import('lightweight-charts').then(({ createChart }) => {
      // --- Candlestick Chart ---
      if (!candleEl) return;
      const candleChart = createChart(candleEl, {
        ...chartTheme,
        height: 400,
        autoSize: true,
      });

      const candleData = bars.map(b => ({
        time: b.t,
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
      })).filter(b => b.time && b.open != null);

      const candleSeries = candleChart.addCandlestickSeries({
        upColor: '#00c853',
        downColor: '#ff1744',
        borderUpColor: '#00c853',
        borderDownColor: '#ff1744',
        wickUpColor: '#00c853',
        wickDownColor: '#ff1744',
      });
      candleSeries.setData(candleData);

      // Volume overlay
      const volumeData = bars.map(b => ({
        time: b.t,
        value: b.v,
        color: b.c >= b.o ? '#00c85333' : '#ff174433',
      })).filter(v => v.time);
      const volumeSeries = candleChart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'vol',
      });
      candleChart.priceScale('vol').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      volumeSeries.setData(volumeData);

      // Bollinger Bands
      if (showBollinger && bollinger.mid.some(v => v !== null)) {
        const bbMid = [], bbUpper = [], bbLower = [];
        for (let i = 0; i < bars.length; i++) {
          const t = bars[i].t;
          if (t && bollinger.mid[i] !== null) {
            bbMid.push({ time: t, value: bollinger.mid[i] });
            bbUpper.push({ time: t, value: bollinger.upper[i] });
            bbLower.push({ time: t, value: bollinger.lower[i] });
          }
        }
        const bbStyle = { color: '#7c4dff', lineWidth: 1 };
        candleChart.addLineSeries({ ...bbStyle, lineStyle: 0, title: 'BB Mid' }).setData(bbMid);
        candleChart.addLineSeries({ ...bbStyle, lineStyle: 2, title: 'BB Upper' }).setData(bbUpper);
        candleChart.addLineSeries({ ...bbStyle, lineStyle: 2, title: 'BB Lower' }).setData(bbLower);
      }

      candleChart.timeScale().fitContent();
      chartsRef.current.push(candleChart);

      // --- RSI Chart ---
      if (showRSI && rsiEl) {
        const rsiChart = createChart(rsiEl, {
          ...chartTheme,
          height: 150,
          autoSize: true,
        });
        const rsiSeriesData = [];
        for (let i = 0; i < bars.length; i++) {
          if (bars[i].t && rsiData[i] !== null && rsiData[i] !== undefined) {
            rsiSeriesData.push({ time: bars[i].t, value: rsiData[i] });
          }
        }
        rsiChart.addLineSeries({
          color: '#448aff',
          lineWidth: 2,
          title: 'RSI(14)',
        }).setData(rsiSeriesData);

        // Reference lines at 70 and 30
        const timePoints = candleData.map(b => b.time);
        rsiChart.addLineSeries({
          color: '#ff1744',
          lineWidth: 1,
          lineStyle: 2,
          lastValueVisible: false,
          priceLineVisible: false,
        }).setData(timePoints.map(t => ({ time: t, value: 70 })));

        rsiChart.addLineSeries({
          color: '#00c853',
          lineWidth: 1,
          lineStyle: 2,
          lastValueVisible: false,
          priceLineVisible: false,
        }).setData(timePoints.map(t => ({ time: t, value: 30 })));

        rsiChart.timeScale().fitContent();
        chartsRef.current.push(rsiChart);

        // Sync time scales
        candleChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
          if (range) rsiChart.timeScale().setVisibleLogicalRange(range);
        });
        rsiChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
          if (range) candleChart.timeScale().setVisibleLogicalRange(range);
        });
      }

      // --- MACD Chart ---
      if (showMACD && macdEl) {
        const macdChart = createChart(macdEl, {
          ...chartTheme,
          height: 150,
          autoSize: true,
        });

        const macdLineData = [], signalLineData = [], histData = [];
        for (let i = 0; i < bars.length; i++) {
          const t = bars[i].t;
          if (t && macdResult.macdLine[i] !== null && macdResult.macdLine[i] !== undefined) {
            macdLineData.push({ time: t, value: macdResult.macdLine[i] });
          }
          if (t && macdResult.signalLine[i] !== null && macdResult.signalLine[i] !== undefined) {
            signalLineData.push({ time: t, value: macdResult.signalLine[i] });
          }
          if (t && macdResult.histogram[i] !== null && macdResult.histogram[i] !== undefined) {
            histData.push({
              time: t,
              value: macdResult.histogram[i],
              color: macdResult.histogram[i] >= 0 ? '#00c853' : '#ff1744',
            });
          }
        }

        macdChart.addLineSeries({
          color: '#448aff',
          lineWidth: 2,
          title: 'MACD',
        }).setData(macdLineData);

        macdChart.addLineSeries({
          color: '#ff9100',
          lineWidth: 1,
          title: 'Signal',
        }).setData(signalLineData);

        macdChart.addHistogramSeries({
          title: 'Hist',
        }).setData(histData);

        macdChart.timeScale().fitContent();
        chartsRef.current.push(macdChart);

        // Sync time scales
        candleChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
          if (range) macdChart.timeScale().setVisibleLogicalRange(range);
        });
        macdChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
          if (range) candleChart.timeScale().setVisibleLogicalRange(range);
        });
      }

      // Handle resize
      const handleResize = () => {
        candleChart.applyOptions({ width: candleEl?.clientWidth });
        chartsRef.current.forEach(c => {
          if (c !== candleChart) c.applyOptions({ width: candleEl?.clientWidth });
        });
      };
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    });
  }, [bars, showRSI, showMACD, showBollinger]);

  const lastBar = bars.length > 0 ? bars[bars.length - 1] : null;
  const prevBar = bars.length > 1 ? bars[bars.length - 2] : null;
  const priceChange = lastBar && prevBar ? ((lastBar.c - prevBar.c) / prevBar.c * 100) : 0;
  const currentRsi = bars.length > 15 ? calcRsi(bars.map(b => b.c)).filter(v => v !== null).pop() : null;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={pair}
          onChange={e => setPair(e.target.value)}
          className="px-3 py-2 bg-[#252836] border border-[#2d3148] rounded-lg text-sm text-white focus:outline-none focus:border-[#448aff]"
        >
          {PAIRS.map(p => <option key={p} value={p}>{p}</option>)}
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
          {[
            { label: 'RSI', state: showRSI, setter: setShowRSI, color: '#448aff' },
            { label: 'MACD', state: showMACD, setter: setShowMACD, color: '#ff9100' },
            { label: 'Bollinger', state: showBollinger, setter: setShowBollinger, color: '#7c4dff' },
          ].map(ind => (
            <button
              key={ind.label}
              onClick={() => ind.setter(!ind.state)}
              className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                ind.state
                  ? 'text-white'
                  : 'bg-[#252836] border-[#2d3148] text-[#8b8fa3] hover:text-white'
              }`}
              style={ind.state ? { backgroundColor: ind.color + '22', borderColor: ind.color + '44', color: ind.color } : {}}
            >
              {ind.state ? '● ' : '○ '}{ind.label}
            </button>
          ))}
        </div>

        <button
          onClick={loadBars}
          disabled={loading}
          className="px-3 py-1.5 bg-[#252836] hover:bg-[#2d3148] rounded-lg text-sm transition-colors border border-[#2d3148] text-[#8b8fa3] hover:text-white disabled:opacity-50"
        >
          {loading ? '...' : '↻'}
        </button>
      </div>

      {/* Price Header */}
      {lastBar && (
        <div className="flex items-center gap-4 bg-[#1a1d29] rounded-xl border border-[#2d3148] p-4">
          <span className="text-2xl font-bold text-white">
            ${lastBar.c.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: lastBar.c > 100 ? 2 : 6 })}
          </span>
          <span className={`text-sm font-medium ${priceChange >= 0 ? 'text-[#00c853]' : 'text-[#ff1744]'}`}>
            {priceChange >= 0 ? '▲' : '▼'} {Math.abs(priceChange).toFixed(2)}%
          </span>
          {currentRsi !== null && (
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              currentRsi < 30 ? 'bg-[#448aff]/20 text-[#448aff]' :
              currentRsi > 70 ? 'bg-[#ff1744]/20 text-[#ff1744]' :
              'bg-[#8b8fa3]/10 text-[#8b8fa3]'
            }`}>
              RSI: {currentRsi.toFixed(1)}
            </span>
          )}
          <span className="text-xs text-[#8b8fa3] ml-auto">
            {pair} · {timeframe} · {bars.length} bars
          </span>
        </div>
      )}

      {error && (
        <div className="bg-[#ff1744]/10 border border-[#ff1744]/30 text-[#ff1744] px-4 py-2 rounded-lg text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* Charts */}
      {loading && bars.length === 0 ? (
        <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] p-12 text-center">
          <div className="animate-pulse text-3xl mb-3">📊</div>
          <p className="text-[#8b8fa3]">Loading chart data...</p>
        </div>
      ) : bars.length > 0 ? (
        <div className="space-y-1">
          {/* Candlestick Chart */}
          <div className="bg-[#1a1d29] rounded-t-xl border border-[#2d3148] overflow-hidden">
            <div className="px-3 py-1.5 border-b border-[#2d3148]">
              <span className="text-xs text-[#8b8fa3]">
                📈 Candlestick {showBollinger ? '· Bollinger Bands(20,2)' : ''} · Volume
              </span>
            </div>
            <div ref={candlestickRef} className="w-full" />
          </div>

          {/* RSI Chart */}
          {showRSI && (
            <div className="bg-[#1a1d29] border-x border-[#2d3148] overflow-hidden">
              <div className="px-3 py-1.5 border-b border-[#2d3148]">
                <span className="text-xs text-[#448aff]">
                  📉 RSI(14) · Oversold &lt;30 · Overbought &gt;70
                </span>
              </div>
              <div ref={rsiRef} className="w-full" />
            </div>
          )}

          {/* MACD Chart */}
          {showMACD && (
            <div className="bg-[#1a1d29] rounded-b-xl border border-[#2d3148] overflow-hidden">
              <div className="px-3 py-1.5 border-b border-[#2d3148]">
                <span className="text-xs text-[#ff9100]">
                  📊 MACD(12,26,9) · Signal · Histogram
                </span>
              </div>
              <div ref={macdRef} className="w-full" />
            </div>
          )}

          {/* Bottom border when no MACD */}
          {!showMACD && !showRSI && (
            <div className="bg-[#1a1d29] rounded-b-xl border border-[#2d3148] border-t-0 h-0" />
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center h-48 text-[#8b8fa3]">
          No chart data available for {pair}
        </div>
      )}
    </div>
  );
}