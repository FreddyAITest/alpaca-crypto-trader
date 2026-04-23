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

  // Helper to read CSS variable values for Lightweight Charts API
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

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
        background: { type: 'solid', color: cssVar('--bg-card') },
        textColor: cssVar('--text-muted'),
      },
      grid: {
        vertLines: { color: cssVar('--border') },
        horzLines: { color: cssVar('--border') },
      },
      crosshair: {
        vertLine: { color: cssVar('--accent-blue') + '44', labelBackgroundColor: cssVar('--accent-blue') },
        horzLine: { color: cssVar('--accent-blue') + '44', labelBackgroundColor: cssVar('--accent-blue') },
      },
      timeScale: {
        borderColor: cssVar('--border'),
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: cssVar('--border'),
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
        upColor: cssVar('--accent-green'),
        downColor: cssVar('--accent-red'),
        borderUpColor: cssVar('--accent-green'),
        borderDownColor: cssVar('--accent-red'),
        wickUpColor: cssVar('--accent-green'),
        wickDownColor: cssVar('--accent-red'),
      });
      candleSeries.setData(candleData);

      // Volume overlay
      const volumeData = bars.map(b => ({
        time: b.t,
        value: b.v,
        color: b.c >= b.o ? cssVar('--accent-green') + '33' : cssVar('--accent-red') + '33',
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
        const bbStyle = { color: getComputedStyle(document.documentElement).getPropertyValue('--accent-indigo').trim() || '#7c4dff', lineWidth: 1 };
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
          color: cssVar('--accent-blue'),
          lineWidth: 2,
          title: 'RSI(14)',
        }).setData(rsiSeriesData);

        // Reference lines at 70 and 30
        const timePoints = candleData.map(b => b.time);
        rsiChart.addLineSeries({
          color: cssVar('--accent-red'),
          lineWidth: 1,
          lineStyle: 2,
          lastValueVisible: false,
          priceLineVisible: false,
        }).setData(timePoints.map(t => ({ time: t, value: 70 })));

        rsiChart.addLineSeries({
          color: cssVar('--accent-green'),
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
              color: macdResult.histogram[i] >= 0 ? cssVar('--accent-green') : cssVar('--accent-red'),
            });
          }
        }

        macdChart.addLineSeries({
          color: cssVar('--accent-blue'),
          lineWidth: 2,
          title: 'MACD',
        }).setData(macdLineData);

        macdChart.addLineSeries({
          color: cssVar('--accent-amber'),
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
          className="px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
        >
          {PAIRS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        <div className="flex bg-[var(--bg-secondary)] rounded-lg border border-[var(--border)] overflow-hidden">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.value}
              onClick={() => setTimeframe(tf.value)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                timeframe === tf.value
                  ? 'bg-[var(--accent-blue)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          {[
            { label: 'RSI', state: showRSI, setter: setShowRSI, activeClass: 'bg-[var(--accent-blue)]/10 border-[var(--accent-blue)]/25 text-[var(--accent-blue)]' },
            { label: 'MACD', state: showMACD, setter: setShowMACD, activeClass: 'bg-[var(--accent-amber)]/10 border-[var(--accent-amber)]/25 text-[var(--accent-amber)]' },
            { label: 'Bollinger', state: showBollinger, setter: setShowBollinger, activeClass: 'bg-[var(--accent-indigo)]/10 border-[var(--accent-indigo)]/25 text-[var(--accent-indigo)]' },
          ].map(ind => (
            <button
              key={ind.label}
              onClick={() => ind.setter(!ind.state)}
              className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                ind.state
                  ? ind.activeClass
                  : 'bg-[var(--bg-secondary)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {ind.state ? '● ' : '○ '}{ind.label}
            </button>
          ))}
        </div>

        <button
          onClick={loadBars}
          disabled={loading}
          className="px-3 py-1.5 bg-[var(--bg-secondary)] hover:bg-[var(--border)] rounded-lg text-sm transition-colors border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50"
        >
          {loading ? '...' : '↻'}
        </button>
      </div>

      {/* Price Header */}
      {lastBar && (
        <div className="flex items-center gap-4 bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <span className="text-2xl font-bold text-[var(--text-primary)]">
            ${lastBar.c.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: lastBar.c > 100 ? 2 : 6 })}
          </span>
          <span className={`text-sm font-medium ${priceChange >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
            {priceChange >= 0 ? '▲' : '▼'} {Math.abs(priceChange).toFixed(2)}%
          </span>
          {currentRsi !== null && (
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              currentRsi < 30 ? 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)]' :
              currentRsi > 70 ? 'bg-[var(--accent-red)]/20 text-[var(--accent-red)]' :
              'bg-[var(--text-muted)]/10 text-[var(--text-muted)]'
            }`}>
              RSI: {currentRsi.toFixed(1)}
            </span>
          )}
          <span className="text-xs text-[var(--text-muted)] ml-auto">
            {pair} · {timeframe} · {bars.length} bars
          </span>
        </div>
      )}

      {error && (
        <div className="bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/30 text-[var(--accent-red)] px-4 py-2 rounded-lg text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* Charts */}
      {loading && bars.length === 0 ? (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-12 text-center">
          <div className="animate-pulse text-3xl mb-3">📊</div>
          <p className="text-[var(--text-muted)]">Loading chart data...</p>
        </div>
      ) : bars.length > 0 ? (
        <div className="space-y-1">
          {/* Candlestick Chart */}
          <div className="bg-[var(--bg-card)] rounded-t-xl border border-[var(--border)] overflow-hidden">
            <div className="px-3 py-1.5 border-b border-[var(--border)]">
              <span className="text-xs text-[var(--text-muted)]">
                📈 Candlestick {showBollinger ? '· Bollinger Bands(20,2)' : ''} · Volume
              </span>
            </div>
            <div ref={candlestickRef} className="w-full" />
          </div>

          {/* RSI Chart */}
          {showRSI && (
            <div className="bg-[var(--bg-card)] border-x border-[var(--border)] overflow-hidden">
              <div className="px-3 py-1.5 border-b border-[var(--border)]">
                <span className="text-xs text-[var(--accent-blue)]">
                  📉 RSI(14) · Oversold &lt;30 · Overbought &gt;70
                </span>
              </div>
              <div ref={rsiRef} className="w-full" />
            </div>
          )}

          {/* MACD Chart */}
          {showMACD && (
            <div className="bg-[var(--bg-card)] rounded-b-xl border border-[var(--border)] overflow-hidden">
              <div className="px-3 py-1.5 border-b border-[var(--border)]">
                <span className="text-xs text-[var(--accent-amber)]">
                  📊 MACD(12,26,9) · Signal · Histogram
                </span>
              </div>
              <div ref={macdRef} className="w-full" />
            </div>
          )}

          {/* Bottom border when no MACD */}
          {!showMACD && !showRSI && (
            <div className="bg-[var(--bg-card)] rounded-b-xl border border-[var(--border)] border-t-0 h-0" />
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center h-48 text-[var(--text-muted)]">
          No chart data available for {pair}
        </div>
      )}
    </div>
  );
}