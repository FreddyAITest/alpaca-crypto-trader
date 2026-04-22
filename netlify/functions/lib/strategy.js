// Trading Strategy Engine
// EMA Crossover + RSI + Volume Confirmation
// Conservative crypto signals for 2-8% daily target

/**
 * Calculate Exponential Moving Average
 */
function ema(data, period) {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const result = [];
  
  // First EMA is SMA
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  result[period - 1] = sum / period;
  
  for (let i = period; i < data.length; i++) {
    result[i] = data[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

/**
 * Calculate RSI (Relative Strength Index)
 */
function rsi(closes, period = 14) {
  if (closes.length < period + 1) return [];
  const result = [];
  let gains = 0, losses = 0;
  
  // Initial averages
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  result[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  return result;
}

/**
 * Simple volume average
 */
function avgVolume(volumes, period = 20) {
  const slice = volumes.slice(-period);
  if (slice.length === 0) return 0;
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/**
 * Analyze bars and generate trading signal
 * Returns: { signal: 'buy'|'sell'|'hold', strength: 0-1, reasons: [] }
 */
export function analyzeSymbol(bars) {
  if (!bars || bars.length < 50) {
    return { signal: "hold", strength: 0, reasons: ["Insufficient data"] };
  }

  const closes = bars.map(b => b.c || b.close);
  const volumes = bars.map(b => b.v || b.volume);
  const highs = bars.map(b => b.h || b.high);
  const lows = bars.map(b => b.l || b.low);

  // Calculate indicators
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const rsi14 = rsi(closes, 14);
  const volAvg = avgVolume(volumes, 20);

  const lastIdx = closes.length - 1;
  const prevIdx = lastIdx - 1;

  const reasons = [];
  let buySignals = 0;
  let sellSignals = 0;
  const totalChecks = 4;

  // 1. EMA Crossover
  const currentDiff = ema9[lastIdx] - ema21[lastIdx];
  const prevDiff = ema9[prevIdx] - ema21[prevIdx];
  
  if (ema9[prevIdx] <= ema21[prevIdx] && ema9[lastIdx] > ema21[lastIdx]) {
    buySignals++;
    reasons.push("EMA 9/21 bullish crossover");
  } else if (ema9[prevIdx] >= ema21[prevIdx] && ema9[lastIdx] < ema21[lastIdx]) {
    sellSignals++;
    reasons.push("EMA 9/21 bearish crossover");
  } else if (ema9[lastIdx] > ema21[lastIdx]) {
    buySignals += 0.5; // Trend continuation
    reasons.push("EMA 9 > 21 (uptrend)");
  } else {
    sellSignals += 0.5;
    reasons.push("EMA 9 < 21 (downtrend)");
  }

  // 2. RSI
  const currentRsi = rsi14[lastIdx];
  if (currentRsi < 30) {
    buySignals++;
    reasons.push(`RSI oversold: ${currentRsi.toFixed(1)}`);
  } else if (currentRsi > 70) {
    sellSignals++;
    reasons.push(`RSI overbought: ${currentRsi.toFixed(1)}`);
  } else if (currentRsi < 45) {
    buySignals += 0.3;
    reasons.push(`RSI neutral-bullish: ${currentRsi.toFixed(1)}`);
  } else if (currentRsi > 55) {
    sellSignals += 0.3;
    reasons.push(`RSI neutral-bearish: ${currentRsi.toFixed(1)}`);
  }

  // 3. Volume confirmation
  const lastVol = volumes[lastIdx];
  if (lastVol > volAvg * 1.5) {
    // High volume confirms current direction
    if (ema9[lastIdx] > ema21[lastIdx]) {
      buySignals++;
      reasons.push("High volume confirms uptrend");
    } else {
      sellSignals++;
      reasons.push("High volume confirms downtrend");
    }
  }

  // 4. Price action - recent candle
  const bodySize = Math.abs(closes[lastIdx] - (bars[lastIdx].o || bars[lastIdx].open));
  const wickSize = highs[lastIdx] - lows[lastIdx];
  if (bodySize > wickSize * 0.6) {
    if (closes[lastIdx] > (bars[lastIdx].o || bars[lastIdx].open)) {
      buySignals += 0.5;
      reasons.push("Strong bullish candle");
    } else {
      sellSignals += 0.5;
      reasons.push("Strong bearish candle");
    }
  }

  // Determine final signal
  const strength = Math.max(buySignals, sellSignals) / totalChecks;
  
  if (buySignals > sellSignals && strength >= 0.5) {
    return { signal: "buy", strength: Math.min(strength, 1), reasons };
  } else if (sellSignals > buySignals && strength >= 0.5) {
    return { signal: "sell", strength: Math.min(strength, 1), reasons };
  }
  
  reasons.push("No strong signal - holding");
  return { signal: "hold", strength: 0, reasons };
}

/**
 * Scan multiple symbols and return actionable signals
 */
export function scanSymbols(barsBySymbol) {
  const signals = [];
  for (const [symbol, bars] of Object.entries(barsBySymbol)) {
    const analysis = analyzeSymbol(bars);
    if (analysis.signal !== "hold") {
      signals.push({ symbol, ...analysis });
    }
  }
  // Sort by strength (strongest first)
  return signals.sort((a, b) => b.strength - a.strength);
}

// Watch list of crypto pairs
export const WATCH_LIST = [
  "BTC/USD",
  "ETH/USD",
  "SOL/USD",
  "DOGE/USD",
  "ADA/USD",
  "AVAX/USD",
  "LINK/USD",
  "MATIC/USD",
  "XRP/USD",
  "DOT/USD",
  "UNI/USD",
  "ATOM/USD",
];