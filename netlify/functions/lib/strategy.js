// Trading Strategy Engine v3 - HIGH-VOLUME LEARNING BOT
// EMA Crossover + RSI + MACD + Bollinger Bands + Volume + Momentum + VWAP + Stochastic
// Multi-timeframe analysis, expanded 60+ watch list, adaptive parameters
// Multi-strategy: momentum, scalping, mean-reversion
// Targets 2-8% daily returns, $500+ per trade, hundreds of trades/day
// Also scans stocks during market hours for additional signals

// =============================================
// TECHNICAL INDICATORS
// =============================================

/**
 * Calculate Exponential Moving Average
 */
function ema(data, period) {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const result = [];
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
 * Calculate Stochastic Oscillator (%K and %D)
 */
function stochastic(bars, kPeriod = 14, dPeriod = 3) {
  if (bars.length < kPeriod) return { k: [], d: [] };
  const k = [];
  for (let i = kPeriod - 1; i < bars.length; i++) {
    const slice = bars.slice(i - kPeriod + 1, i + 1);
    const high = Math.max(...slice.map(b => b.h || b.high));
    const low = Math.min(...slice.map(b => b.l || b.low));
    const close = bars[i].c || bars[i].close;
    k.push(high !== low ? ((close - low) / (high - low)) * 100 : 50);
  }
  const d = ema(k, dPeriod);
  // Pad k to align with bars
  const paddedK = new Array(bars.length - k.length).fill(null).concat(k);
  const paddedD = new Array(bars.length - d.length).fill(null).concat(d);
  return { k: paddedK, d: paddedD };
}

/**
 * Calculate MACD
 */
function macd(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const emaFast = ema(closes, fastPeriod);
  const emaSlow = ema(closes, slowPeriod);
  if (emaFast.length < slowPeriod || emaSlow.length < slowPeriod) {
    return { macdLine: [], signalLine: [], histogram: [] };
  }
  const macdLine = [];
  const startIdx = slowPeriod - 1;
  for (let i = startIdx; i < closes.length; i++) {
    if (emaFast[i] !== undefined && emaSlow[i] !== undefined) {
      macdLine.push(emaFast[i] - emaSlow[i]);
    }
  }
  if (macdLine.length < signalPeriod) {
    return { macdLine, signalLine: [], histogram: [] };
  }
  const signalLine = ema(macdLine, signalPeriod);
  const histogram = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (signalLine[i] !== undefined) {
      histogram.push(macdLine[i] - signalLine[i]);
    } else {
      histogram.push(0);
    }
  }
  return { macdLine, signalLine, histogram };
}

/**
 * Calculate Bollinger Bands
 */
function bollingerBands(closes, period = 20, stdDev = 2) {
  if (closes.length < period) return { upper: [], middle: [], lower: [], bandwidth: [], percentB: [] };
  const upper = [], middle = [], lower = [], bandwidth = [], percentB = [];
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / period;
    const std = Math.sqrt(variance);
    const u = avg + stdDev * std;
    const l = avg - stdDev * std;
    upper.push(u);
    middle.push(avg);
    lower.push(l);
    bandwidth.push(std > 0 ? (u - l) / avg : 0);
    percentB.push(u !== l ? (closes[i] - l) / (u - l) : 0.5);
  }
  return { upper, middle, lower, bandwidth, percentB };
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
 * Calculate momentum (rate of change)
 */
function momentum(closes, period = 10) {
  if (closes.length < period + 1) return [];
  return closes.slice(period).map((c, i) => ((c - closes[i]) / closes[i]) * 100);
}

/**
 * Calculate Average True Range (ATR) for volatility measurement
 */
function atr(bars, period = 14) {
  if (bars.length < 2) return [];
  const trValues = [];
  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].h || bars[i].high;
    const low = bars[i].l || bars[i].low;
    const prevClose = bars[i-1].c || bars[i-1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trValues.push(tr);
  }
  if (trValues.length < period) return [];
  const result = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += trValues[i];
  result.push(sum / period);
  for (let i = period; i < trValues.length; i++) {
    result.push((result[result.length - 1] * (period - 1) + trValues[i]) / period);
  }
  return result;
}

/**
 * Simple VWAP approximation (volume-weighted average price)
 */
function vwap(bars) {
  let cumVol = 0, cumTPV = 0;
  const result = [];
  for (const bar of bars) {
    const h = bar.h || bar.high;
    const l = bar.l || bar.low;
    const c = bar.c || bar.close;
    const v = bar.v || bar.volume || 0;
    const tp = (h + l + c) / 3;
    cumVol += v;
    cumTPV += tp * v;
    result.push(cumVol > 0 ? cumTPV / cumVol : c);
  }
  return result;
}

/**
 * Detect support/resistance levels from recent price action
 */
function detectLevels(closes, lookback = 50, tolerance = 0.005) {
  if (closes.length < lookback) return { support: [], resistance: [] };
  const recent = closes.slice(-lookback);
  const highs = [];
  const lows = [];
  
  for (let i = 2; i < recent.length - 2; i++) {
    if (recent[i] > recent[i-1] && recent[i] > recent[i-2] && recent[i] > recent[i+1] && recent[i] > recent[i+2]) {
      highs.push(recent[i]);
    }
    if (recent[i] < recent[i-1] && recent[i] < recent[i-2] && recent[i] < recent[i+1] && recent[i] < recent[i+2]) {
      lows.push(recent[i]);
    }
  }
  
  // Cluster nearby levels
  const cluster = (levels) => {
    if (levels.length === 0) return [];
    levels.sort((a, b) => a - b);
    const clustered = [levels[0]];
    for (let i = 1; i < levels.length; i++) {
      if (Math.abs(levels[i] - clustered[clustered.length - 1]) / clustered[clustered.length - 1] > tolerance) {
        clustered.push(levels[i]);
      }
    }
    return clustered;
  };
  
  return { support: cluster(lows).slice(-3), resistance: cluster(highs).slice(-3) };
}

// =============================================
// ADAPTIVE LEARNING PARAMETERS
// =============================================

let learningState = {
  tradeHistory: [],
  adaptiveParams: {
    rsiOversold: 35,       // Slightly wider than 30 to catch more oversold
    rsiOverbought: 65,     // Slightly wider than 70
    signalThreshold: 0.22, // LOWER = MORE TRADES (was 0.35, now 0.22)
    scalpThreshold: 0.15,  // Even lower threshold for scalp signals
    volumeMultiplier: 1.2, // Lower volume requirement = more signals trigger
    emaFastPeriod: 8,
    emaSlowPeriod: 21,
    stochOverbought: 80,
    stochOversold: 20,
  },
  winRate: 0.5,
  totalWins: 0,
  totalLosses: 0,
  lastAdaptation: null,
};

export function recordTradeOutcome(symbol, signalType, pnl) {
  learningState.tradeHistory.push({
    symbol,
    signal: signalType,
    pnl,
    timestamp: Date.now(),
  });
  learningState.tradeHistory = learningState.tradeHistory.slice(-500);
  if (pnl > 0) learningState.totalWins++;
  else learningState.totalLosses++;
  learningState.winRate = learningState.totalWins / (learningState.totalWins + learningState.totalLosses);
  adaptParameters();
}

function adaptParameters() {
  const recent = learningState.tradeHistory.slice(-50);
  if (recent.length < 10) return;

  const recentWins = recent.filter(t => t.pnl > 0).length;
  const recentWinRate = recentWins / recent.length;

  // More aggressive adaptation ranges
  if (recentWinRate > 0.6) {
    learningState.adaptiveParams.signalThreshold = Math.max(0.12, learningState.adaptiveParams.signalThreshold - 0.015);
    learningState.adaptiveParams.scalpThreshold = Math.max(0.08, learningState.adaptiveParams.scalpThreshold - 0.01);
    learningState.adaptiveParams.rsiOversold = Math.min(42, learningState.adaptiveParams.rsiOversold + 1);
    learningState.adaptiveParams.rsiOverbought = Math.max(58, learningState.adaptiveParams.rsiOverbought - 1);
  } else if (recentWinRate < 0.4) {
    learningState.adaptiveParams.signalThreshold = Math.min(0.4, learningState.adaptiveParams.signalThreshold + 0.02);
    learningState.adaptiveParams.scalpThreshold = Math.min(0.25, learningState.adaptiveParams.scalpThreshold + 0.015);
    learningState.adaptiveParams.rsiOversold = Math.max(25, learningState.adaptiveParams.rsiOversold - 1);
    learningState.adaptiveParams.rsiOverbought = Math.min(75, learningState.adaptiveParams.rsiOverbought + 1);
  }

  learningState.lastAdaptation = new Date().toISOString();
}

export function getLearningState() {
  return { ...learningState, tradeHistory: learningState.tradeHistory.slice(-20) };
}

// =============================================
// EXPANDED WATCH LIST - 60+ CRYPTO PAIRS
// =============================================

export const WATCH_LIST = [
  // Core majors (always trade)
  "BTC/USD", "ETH/USD", "SOL/USD",
  // High-cap with good volume
  "DOGE/USD", "ADA/USD", "AVAX/USD", "LINK/USD", "XRP/USD",
  "DOT/USD", "UNI/USD", "ATOM/USD", "LTC/USD", "BCH/USD",
  // DeFi blue chips
  "AAVE/USD", "CRV/USD", "SUSHI/USD", "UNI/USD", "COMP/USD",
  "MKR/USD", "SNX/USD", "DYDX/USD", "1INCH/USD",
  // L1/L2 chains  
  "MATIC/USD", "NEAR/USD", "ALGO/USD", "ARB/USD", "OP/USD",
  "APT/USD", "SUI/USD", "SEI/USD", "TIA/USD", "JUP/USD",
  "INJ/USD", "TIA/USD",
  // AINarrative / AI tokens
  "FET/USD", "RNDR/USD", "AGIX/USD", "OCEAN/USD", "WLD/USD",
  // Gaming/Metaverse
  "SAND/USD", "MANA/USD", "ENJ/USD", "GALA/USD", "IMX/USD",
  "RON/USD", "PIXEL/USD",
  // Meme coins (high volatility = high daily % moves)
  "SHIB/USD", "PEPE/USD", "WIF/USD", "FLOKI/USD", "BONK/USD",
  "BOME/USD", "MEME/USD",
  // Storage/Oracle/Infra
  "FIL/USD", "GRT/USD", "API3/USD", "PYTH/USD",
  // Other volatile alts
  "APE/USD", "YFI/USD", "BLUR/USD", "PENDLE/USD", "STG/USD",
  "LDO/USD", "RPL/USD", "SSV/USD", "MANTA/USD",
];

// Stock universe for when market is open (scanned separately)
export const STOCK_UNIVERSE = [
  // Mega-cap tech (high volume, good moves)
  "TSLA", "NVDA", "AMD", "AAPL", "MSFT", "GOOGL", "AMZN", "META",
  // Leveraged ETFs (2-8% daily moves common)
  "SOXL", "TQQQ", "SQQQ", "TNA", "TZA", "LABU", "LABD",
  "SPXL", "SPXS", "UPRO", "DRN", "DRV", "WEBX",
  // Crypto-adjacent (move with BTC)
  "MARA", "RIOT", "COIN", "MSTR", "HUT", "CLSK", "BTBT", "CIFR",
  // High-volatility growth
  "PLTR", "SOFI", "RIVN", "LCID", "NIO", "AFRM", "RBLX", "UPST",
  "SMCI", "CRWD", "PANW", "SNOW", "DDOG", "NET", "MDB", "ZS",
  // Meme stocks
  "GME", "AMC", "BBBY", "NKLA", "HOOD",
  // Biotech (volatile)
  "MRNA", "BNTX", "NVAX", "VXRT",
  // China tech
  "BABA", "JD", "PDD", "BILI", "NIO",
  // Momentum plays
  "SHOP", "SQ", "ROKU", "SPOT", "MELI", "ABNB", "RBLX",
  // Earnings movers (refreshed weekly)
  "NFLX", "CRM", "ADBE", "INTC", "DIS", "PFE",
];

// =============================================
// MULTI-STRATEGY ANALYSIS
// =============================================

/**
 * Momentum strategy - rides trends with EMA, MACD, RSI
 * Primary strategy, generates the most signals
 */
function momentumStrategy(bars, params) {
  if (!bars || bars.length < 30) {
    return { signal: "hold", strength: 0, reasons: ["Insufficient data"], strategy: "momentum" };
  }

  const closes = bars.map(b => b.c || b.close);
  const volumes = bars.map(b => b.v || b.volume);
  const highs = bars.map(b => b.h || b.high);
  const lows = bars.map(b => b.l || b.low);

  const ema8 = ema(closes, params.emaFastPeriod || 8);
  const ema21 = ema(closes, params.emaSlowPeriod || 21);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const macdData = macd(closes);
  const mom = momentum(closes, 10);

  const lastIdx = closes.length - 1;
  const prevIdx = lastIdx - 1;

  const reasons = [];
  let buySignals = 0;
  let sellSignals = 0;
  const totalChecks = 7;

  // 1. EMA crossover
  if (ema8[prevIdx] !== undefined && ema21[prevIdx] !== undefined && 
      ema8[lastIdx] !== undefined && ema21[lastIdx] !== undefined) {
    if (ema8[prevIdx] <= ema21[prevIdx] && ema8[lastIdx] > ema21[lastIdx]) {
      buySignals++;
      reasons.push("EMA bullish crossover");
    } else if (ema8[prevIdx] >= ema21[prevIdx] && ema8[lastIdx] < ema21[lastIdx]) {
      sellSignals++;
      reasons.push("EMA bearish crossover");
    } else if (ema8[lastIdx] > ema21[lastIdx]) {
      buySignals += 0.5;
      reasons.push("EMA uptrend");
    } else {
      sellSignals += 0.5;
      reasons.push("EMA downtrend");
    }
  }

  // 2. EMA50 trend
  if (ema50[lastIdx] !== undefined) {
    if (closes[lastIdx] > ema50[lastIdx]) {
      buySignals += 0.3;
    } else {
      sellSignals += 0.3;
    }
  }

  // 3. RSI
  const currentRsi = rsi14[lastIdx];
  if (currentRsi !== undefined) {
    if (currentRsi < params.rsiOversold) {
      buySignals++;
      reasons.push(`RSI oversold: ${currentRsi.toFixed(1)}`);
    } else if (currentRsi > params.rsiOverbought) {
      sellSignals++;
      reasons.push(`RSI overbought: ${currentRsi.toFixed(1)}`);
    } else if (currentRsi < 45) {
      buySignals += 0.3;
    } else if (currentRsi > 55) {
      sellSignals += 0.3;
    }
  }

  // 4. MACD
  if (macdData.histogram.length >= 2) {
    const lastHist = macdData.histogram[macdData.histogram.length - 1];
    const prevHist = macdData.histogram[macdData.histogram.length - 2];
    if (lastHist > 0 && prevHist <= 0) {
      buySignals++;
      reasons.push("MACD bullish cross");
    } else if (lastHist < 0 && prevHist >= 0) {
      sellSignals++;
      reasons.push("MACD bearish cross");
    } else if (lastHist > 0 && lastHist > prevHist) {
      buySignals += 0.4;
    } else if (lastHist < 0 && lastHist < prevHist) {
      sellSignals += 0.4;
    }
  }

  // 5. Momentum
  if (mom.length > 0) {
    const lastMom = mom[mom.length - 1];
    if (lastMom > 1.5) {
      buySignals += 0.5;
      reasons.push(`Momentum +${lastMom.toFixed(1)}%`);
    } else if (lastMom < -1.5) {
      sellSignals += 0.5;
      reasons.push(`Momentum ${lastMom.toFixed(1)}%`);
    }
  }

  // 6. Volume spike
  const volAvg = avgVolume(volumes, 20);
  const lastVol = volumes[lastIdx];
  if (lastVol > volAvg * params.volumeMultiplier) {
    if (closes[lastIdx] > (bars[lastIdx].o || bars[lastIdx].open)) {
      buySignals += 0.5;
    } else {
      sellSignals += 0.5;
    }
  }

  // 7. Price vs VWAP
  const vwapData = vwap(bars);
  if (vwapData[lastIdx] !== undefined) {
    if (closes[lastIdx] > vwapData[lastIdx]) {
      buySignals += 0.3;
      reasons.push("Above VWAP");
    } else {
      sellSignals += 0.3;
      reasons.push("Below VWAP");
    }
  }

  const strength = Math.max(buySignals, sellSignals) / totalChecks;
  const threshold = params.signalThreshold || 0.22;

  if (buySignals > sellSignals && strength >= threshold) {
    return { signal: "buy", strength: Math.min(strength, 1), reasons, strategy: "momentum", indicators: { rsi: currentRsi } };
  } else if (sellSignals > buySignals && strength >= threshold) {
    return { signal: "buy", strength: Math.min(strength, 1) * 0.6, reasons: [...reasons, "(contrarian buy on sell signal - long only)"], strategy: "momentum-contrarian", indicators: { rsi: currentRsi } };
    // Long only - sell signals become contrarian buys at reduced strength
  }

  return { signal: "hold", strength: 0, reasons: ["No momentum signal"], strategy: "momentum", indicators: { rsi: currentRsi } };
}

/**
 * Scalp strategy - fast signals on short timeframes
 * Looks for micro-trends, quick bounces from levels
 */
function scalpStrategy(bars, params) {
  if (!bars || bars.length < 20) {
    return { signal: "hold", strength: 0, reasons: ["Insufficient data"], strategy: "scalp" };
  }

  const closes = bars.map(b => b.c || b.close);
  const volumes = bars.map(b => b.v || b.volume);

  const reasons = [];
  let buySignals = 0;
  let sellSignals = 0;
  const totalChecks = 5;

  const lastIdx = closes.length - 1;

  // 1. Quick EMA (5/13)
  const ema5 = ema(closes, 5);
  const ema13 = ema(closes, 13);
  if (ema5[lastIdx] !== undefined && ema13[lastIdx] !== undefined) {
    if (ema5[lastIdx] > ema13[lastIdx] && ema5[lastIdx - 1] <= ema13[lastIdx - 1]) {
      buySignals++;
      reasons.push("Scalp: EMA 5/13 cross up");
    } else if (ema5[lastIdx] > ema13[lastIdx]) {
      buySignals += 0.3;
    }
  }

  // 2. RSI bounce from oversold
  const rsi14 = rsi(closes, 14);
  const currentRsi = rsi14[lastIdx];
  if (currentRsi !== undefined) {
    if (currentRsi < 30 && rsi14[lastIdx - 1] < currentRsi) {
      buySignals++;
      reasons.push(`Scalp: RSI bouncing from ${currentRsi.toFixed(1)}`);
    } else if (currentRsi < 40) {
      buySignals += 0.3;
    }
  }

  // 3. Bollinger Band squeeze + bounce
  const bb = bollingerBands(closes, 20, 2);
  if (bb.percentB.length > 0) {
    const lastPB = bb.percentB[bb.percentB.length - 1];
    if (lastPB < 0.05) {
      buySignals++;
      reasons.push("Scalp: BB lower band touch");
    } else if (lastPB < 0.2) {
      buySignals += 0.3;
    }
  }

  // 4. Support level bounce
  const levels = detectLevels(closes, 30);
  if (levels.support.length > 0) {
    const nearestSupport = levels.support[levels.support.length - 1];
    const distToSupport = (closes[lastIdx] - nearestSupport) / nearestSupport;
    if (distToSupport > -0.005 && distToSupport < 0.01) {
      buySignals++;
      reasons.push("Scalp: Near support level");
    }
  }

  // 5. Volume spike (unusual activity = something happening)
  const volAvg = avgVolume(volumes, 10);
  if (volumes[lastIdx] > volAvg * 2) {
    buySignals += 0.5;
    reasons.push("Scalp: Volume spike");
  }

  const strength = Math.max(buySignals, sellSignals) / totalChecks;
  const threshold = params.scalpThreshold || 0.15;

  if (strength >= threshold && buySignals > 0) {
    return { signal: "buy", strength: Math.min(strength, 0.8), reasons, strategy: "scalp", indicators: { rsi: currentRsi } };
  }

  return { signal: "hold", strength: 0, reasons: ["No scalp signal"], strategy: "scalp", indicators: { rsi: currentRsi } };
}

/**
 * Mean-reversion strategy - buys oversold, sells overbought
 * Works in ranging/sideways markets
 */
function meanReversionStrategy(bars, params) {
  if (!bars || bars.length < 30) {
    return { signal: "hold", strength: 0, reasons: ["Insufficient data"], strategy: "mean-reversion" };
  }

  const closes = bars.map(b => b.c || b.close);

  const reasons = [];
  let buySignals = 0;
  const totalChecks = 4;

  const lastIdx = closes.length - 1;

  // 1. RSI deeply oversold
  const rsi14 = rsi(closes, 14);
  const currentRsi = rsi14[lastIdx];
  if (currentRsi !== undefined) {
    if (currentRsi < 25) {
      buySignals += 1.5;
      reasons.push(`MR: RSI deeply oversold ${currentRsi.toFixed(1)}`);
    } else if (currentRsi < 30) {
      buySignals++;
      reasons.push(`MR: RSI oversold ${currentRsi.toFixed(1)}`);
    }
  }

  // 2. Below lower Bollinger Band
  const bb = bollingerBands(closes, 20, 2);
  if (bb.percentB.length > 0) {
    const lastPB = bb.percentB[bb.percentB.length - 1];
    if (lastPB < -0.1) {
      buySignals += 1.5;
      reasons.push("MR: Far below lower BB");
    } else if (lastPB < 0) {
      buySignals++;
      reasons.push("MR: Below lower BB");
    }
  }

  // 3. Price far from mean (20-SMA)
  const sma20 = ema(closes, 20); // Using EMA as SMA approx
  if (sma20[lastIdx] !== undefined) {
    const distFromMean = (closes[lastIdx] - sma20[lastIdx]) / sma20[lastIdx];
    if (distFromMean < -0.03) {
      buySignals += 1.5;
      reasons.push(`MR: ${(-distFromMean*100).toFixed(1)}% below mean`);
    } else if (distFromMean < -0.015) {
      buySignals++;
      reasons.push(`MR: ${(-distFromMean*100).toFixed(1)}% below mean`);
    }
  }

  // 4. Stochastic oversold
  const stochData = stochastic(bars);
  const lastStochK = stochData.k[lastIdx];
  const lastStochD = stochData.d[lastIdx];
  if (lastStochK !== null && lastStochK !== undefined && lastStochD !== undefined) {
    if (lastStochK < params.stochOversold && lastStochK > lastStochD) {
      buySignals++;
      reasons.push(`MR: Stoch turning up from ${lastStochK.toFixed(0)}`);
    }
  }

  const strength = buySignals / totalChecks;

  if (strength >= 0.3) {
    return { signal: "buy", strength: Math.min(strength, 0.9), reasons, strategy: "mean-reversion", indicators: { rsi: currentRsi } };
  }

  return { signal: "hold", strength: 0, reasons: ["No MR signal"], strategy: "mean-reversion", indicators: { rsi: currentRsi } };
}

// =============================================
// COMBINED ANALYSIS
// =============================================

/**
 * Analyze a symbol using ALL strategies and pick the best signal
 */
export function analyzeSymbol(bars, customParams = null) {
  if (!bars || bars.length < 20) {
    return { signal: "hold", strength: 0, reasons: ["Insufficient data"], indicators: {}, strategy: "none" };
  }

  const params = customParams || learningState.adaptiveParams;

  // Run all 3 strategies
  const momentum = momentumStrategy(bars, params);
  const scalp = scalpStrategy(bars, params);
  const meanRev = meanReversionStrategy(bars, params);

  // Also get ATR and BB for indicators
  const closes = bars.map(b => b.c || b.close);
  const atrData = atr(bars, 14);
  const bb = bollingerBands(closes, 20, 2);
  const currentAtr = atrData.length > 0 ? atrData[atrData.length - 1] : 0;
  const atrPct = currentAtr > 0 ? (currentAtr / closes[closes.length - 1]) * 100 : 0;
  const currentRsi = rsi(closes, 14);
  const lastRsi = currentRsi.length > 0 ? currentRsi[currentRsi.length - 1] : undefined;

  const indicators = {
    rsi: lastRsi,
    atr: currentAtr,
    atrPct,
    bbPercentB: bb.percentB.length > 0 ? bb.percentB[bb.percentB.length - 1] : undefined,
  };

  // Combine: pick the strongest signal
  const candidates = [momentum, scalp, meanRev].filter(s => s.signal !== "hold");

  if (candidates.length === 0) {
    return { signal: "hold", strength: 0, reasons: ["No signal from any strategy"], indicators, strategy: "none" };
  }

  // Pick the strongest
  candidates.sort((a, b) => b.strength - a.strength);
  const best = candidates[0];

  // If multiple strategies agree, boost strength
  const agreeingCount = candidates.filter(c => c.signal === best.signal).length;
  let finalStrength = best.strength;
  if (agreeingCount > 1) {
    finalStrength = Math.min(1, best.strength * 1.25);
    best.reasons.push(`+${agreeingCount - 1} strategy confirmation`);
  }

  return {
    signal: best.signal,
    strength: finalStrength,
    reasons: best.reasons,
    strategy: best.strategy,
    strategies: { momentum: momentum.signal, scalp: scalp.signal, meanReversion: meanRev.signal },
    indicators,
  };
}

/**
 * Multi-timeframe analysis - combines signals from different timeframes
 * Primary (1H) + Fast (15M) for entry timing
 */
export function analyzeMultiTimeframe(bars1H, bars15M) {
  const primary = analyzeSymbol(bars1H);

  if (!bars15M || bars15M.length < 20) {
    return { ...primary, timeframe: "1H only", confirmed: false };
  }

  const fast = analyzeSymbol(bars15M);

  let confirmed = false;
  let finalStrength = primary.strength;
  let combinedReasons = [...primary.reasons];

  if (primary.signal !== "hold" && primary.signal === fast.signal) {
    confirmed = true;
    finalStrength = Math.min(1, primary.strength * 1.3);
    combinedReasons.push(`15M confirms ${fast.signal} (${fast.strategy})`);
  } else if (primary.signal !== "hold" && fast.signal === "hold") {
    combinedReasons.push("15M neutral");
  } else if (primary.signal !== "hold" && primary.signal !== fast.signal) {
    finalStrength = primary.strength * 0.75;
    combinedReasons.push(`15M conflicts (${fast.signal})`);
  }

  return {
    signal: primary.signal,
    strength: finalStrength,
    reasons: combinedReasons,
    confirmed,
    timeframe: "1H+15M",
    strategy: primary.strategy,
    strategies: primary.strategies,
    primaryAnalysis: { signal: primary.signal, strength: primary.strength, strategy: primary.strategy },
    fastAnalysis: { signal: fast.signal, strength: fast.strength, strategy: fast.strategy },
    indicators: primary.indicators || {},
  };
}

/**
 * Scan multiple symbols and return actionable signals
 * Now also runs 5M timeframe analysis for scalp signals
 */
export function scanSymbols(barsBySymbol, bars15MBySymbol = {}, bars5MBySymbol = {}) {
  const signals = [];
  for (const [symbol, bars] of Object.entries(barsBySymbol)) {
    const bars15M = bars15MBySymbol[symbol];
    const bars5M = bars5MBySymbol[symbol];
    
    // Primary analysis with multi-timeframe
    let analysis;
    if (bars15M) {
      analysis = analyzeMultiTimeframe(bars, bars15M);
    } else {
      analysis = analyzeSymbol(bars);
    }

    // Also check 5M for scalp confirmation
    if (bars5M && analysis.signal === "hold") {
      const scalpCheck = scalpStrategy(bars5M, learningState.adaptiveParams);
      if (scalpCheck.signal !== "hold" && scalpCheck.strength >= (learningState.adaptiveParams.scalpThreshold || 0.15)) {
        analysis = { ...scalpCheck, symbol, timeframe: "5M-scalp" };
      }
    }

    if (analysis.signal !== "hold") {
      signals.push({ symbol, ...analysis });
    }
  }

  return signals.sort((a, b) => b.strength - a.strength);
}

/**
 * Scan for high-momentum movers from snapshot data
 * Lowered threshold to 0.8% to catch more potential movers
 */
export function scanMovers(snapshots) {
  if (!snapshots) return [];
  const movers = [];
  for (const [symbol, snap] of Object.entries(snapshots)) {
    const prevDaily = snap.prevDailyBar?.c || snap.prevDailyBar?.close;
    const latest = snap.latestTrade?.p || snap.dailyBar?.c;
    if (prevDaily && latest) {
      const dailyChange = ((latest - prevDaily) / prevDaily) * 100;
      if (Math.abs(dailyChange) > 0.8) { // Lowered from 1.5% to 0.8% for more movers
        movers.push({
          symbol,
          price: latest,
          dailyChange,
          direction: dailyChange > 0 ? "up" : "down",
          volume: snap.dailyBar?.v || 0,
        });
      }
    }
  }
  return movers.sort((a, b) => Math.abs(b.dailyChange) - Math.abs(a.dailyChange));
}

/**
 * Scan stock snapshots for movers (used when market is open)
 */
export function scanStockMovers(snapshots) {
  if (!snapshots) return [];
  const movers = [];
  for (const [symbol, snap] of Object.entries(snapshots)) {
    const prevClose = snap.prevDailyBar?.c || snap.prevDailyBar?.close;
    const latestPrice = snap.latestTrade?.p || snap.dailyBar?.c;
    if (prevClose && latestPrice && prevClose > 5) {
      const dailyChange = ((latestPrice - prevClose) / prevClose) * 100;
      if (Math.abs(dailyChange) >= 1.5) {
        movers.push({ symbol, price: latestPrice, dailyChange, direction: dailyChange > 0 ? "up" : "down" });
      }
    }
  }
  return movers.sort((a, b) => Math.abs(b.dailyChange) - Math.abs(a.dailyChange));
}