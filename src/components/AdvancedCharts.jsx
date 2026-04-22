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

function sma(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    result.push(sum / period);
  }
  return result;
}

function calcRsi(closes, period = 14) {
  if (closes.length < period + 1) return [];
  const result = new Array(closes.length).fill(null);
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
  const histogram = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    if (macdLine[i] !== null && fullSignal[i] !== null) {
      histogram[i] = macdLine[i] - fullSignal[i];
    }
  }
  return { macdLine, signalLine: fullSignal, histogram };
}

function calcBollinger(closes, period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper = [], lower = [];
  for (let i = 0; i < closes.length; i++) {
    if (mid[i] === null) { upper.push(null); lower.push(null); continue; }
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += (closes[j] - mid[i]) ** 2;
    const std = Math.sqrt(sumSq / period);
    upper.push(mid[i] + mult * std);
    lower.push(mid[i] - mult * std);
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

  useEffect(() => {
    loadBars();
  }, [loadBars]);

  // Render charts when bars change
  useEffect(() => {
    if (!bars || bars.length === 0) return;

    const closes = bars.map(b => b.c);
    const rsiData = calcRsi(closes);
    const macdResult = calcMacd(closes);
    const bollinger = calcBollinger(closes);

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

    // Cleanup previous chart instances
    const candleEl = candlestickRef.current;
    const rsiEl = rsiRef.current;
    const macdEl = macdRef.current;
    if (candleEl) candleEl.innerHTML = '';
    if (rsiEl) rsiEl.innerHTML = '';
    if (macdEl) macdEl.innerHTML = '';

    import('lightweight-charts').then(({ createChart }) => {
      // --- Candlestick Chart ---
      if (!candleEl) return;
      const candleChart = createChart(candleEl, {
        ...chartTheme,
        height: 400,
        autoSize: true,
      });

      // Map bars to lightweight-charts format
      const candleData = bars.map(b => ({
        time: b.t ? b.t : (b.Timestamp ? b.Timestamp : Math.floor(new Date(b.t || b.start || b.time).getTime() / 1000)),
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

      // Volume as histogram overlay
      const volumeData = bars.map(b => ({
        time: b.t ? b.t : Math.floor(new Date(b.t || b.start || b.time).getTime() / 1000),
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
          const t = bars[i].t ? bars[i].t : Math.floor(new Date(bars[i].t || bars[i].start || bars[i].time).getTime() / 1000);
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

      // --- RSI Chart ---
      if (showRSI && rsiEl) {
        const rsiChart = createChart(rsiEl, {
          ...chartTheme,
          height: 150,
          autoSize: true,
        });
        const rsiSeriesData = [];
        for (let i = 0; i < bars.length; i++) {
          const t = bars[i].t ? bars[i].t : Math.floor(new Date(bars[i].t || bars[i].start || bars[i].time).getTime() / 1000);
          if (t && rsiData[i] !== null && rsiData[i] !== undefined) {
            rsiSeriesData.push({ time: t, value: rsiData[i] });
          }
        }
        rsiChart.addLineSeries({
          color: '#448aff',
          lineWidth: 2,
          title: 'RSI(14)',
        }).setData(rsiSeriesData);

        // Overbought/Oversold reference lines
        rsiChart.addLineSeries({
          color: '#ff1744',
          lineWidth: 1,
          lineStyle: 2,
          lineVisible: true,
          title: '',
          lastValueVisible: false,
          priceLineVisible: false,
        }).setData(bars.map(b => ({
          time: b.t ? b.t : Math.floor(new Date(b.t || b.start || b.time).getTime() / 1000),
          value: 70,
        })).filter(b => b.time));

        rsiChart.addLineSeries({
          color: '#00c853',
          lineWidth: 1,
          lineStyle: 2,
          lineVisible: true,
          title: '',
          lastValueVisible: false,
          priceLineVisible: false,
        }).setData(bars.map(b => ({
          time: b.t ? b.t : Math.floor(new Date(b.t || b.start || b.time).getTime() / 1000),
          value: 30,
        })).filter(b => b.time));

        rsiChart.timeScale().fitContent();

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
          const t = bars[i].t ? bars[i].t : Math.floor(new Date(bars[i].t || bars[i].start || bars[i].time).getTime() / 1000);
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
        if (candleEl) candleChart.applyOptions({ width: candleEl.clientWidth });
        if (showRSI && rsiEl) {
          const rsiChartInstance = rsiEl.__chart;
          if (rsiChartInstance) rsiChartInstance.applyOptions({ width: rsiEl.clientWidth });
        }
        if (showMACD && macdEl) {
          const macdChartInstance = macdEl.__chart;
          if (macdChartInstance) macdChartInstance.applyOptions({ width: macdEl.clientWidth });
        }
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
          className="px-3 py-2 bg-[#252836] border border-[#2d3148] rounded-lg text-sm text-white"
        >
          {PAIRS.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        {TIMEFRAMES.map(tf => (
          <button
            key={tf.value}
            onClick={() => setTimeframe(tf.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              timeframe === tf.value
                ? 'bg-[#448aff] text-white'
                : 'bg-[#252836] text-[#8b8fa3] hover:text-white border border-[#2d3148]'
            }`}
          >
            {tf.label}
          </button>
        ))}

        <div className="flex items-center gap-2 ml-4">
          {[
            { label: 'RSI', state: showRSI, setter: setShowRSI, color: '#448aff' },
            { label: 'MACD', state: showMACD, setter: setShowMACD, color: '#ff9100' },
            { label: 'Bollinger', state: showBollinger, setter: setShowBollinger, color: '#7c4dff' },
          ].map(ind => (
            <button
              key={ind.label}
              onClick={() => ind.setter(!ind.state)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                ind.state
                  ? 'text-white border'
                  : 'text-[#8b8fa3] border border-[#2d3148] opacity-50'
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
          className="px-4 py-2 bg-[#448aff] text-white rounded-lg text-sm font-medium hover:bg-[#448aff]/80 transition-colors disabled:opacity-50 ml-auto"
        >
          {loading ? '🔄 Loading...' : '↻ Refresh'}
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
        </div>
      ) : null}
    </div>
  );
}