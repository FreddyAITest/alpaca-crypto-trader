// Crypto Pair Scanner - Netlify Function (v2)
// Evaluates crypto pairs for short-term trading opportunities
// Uses RSI, MACD, volume spikes, volatility filters
// Targets 2-8% daily profit candidates

import { getCryptoBars, getCryptoSnapshot } from "./lib/alpaca-client.mjs";

// Technical indicator calculations
function ema(data, period) {
  const k = 2 / (period + 1);
  let result = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
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

function rsi(closes, period = 14) {
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] >= 0) avgGain += changes[i];
    else avgLoss -= changes[i];
  }
  avgGain /= period;
  avgLoss /= period;
  const results = new Array(period).fill(null);
  results.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period; i < changes.length; i++) {
    const g = changes[i] >= 0 ? changes[i] : 0;
    const l = changes[i] < 0 ? -changes[i] : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    results.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return results;
}

function macd(closes, fast = 12, slow = 26, signal = 9) {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const macdLine = fastEma.map((f, i) => f - slowEma[i]);
  const signalLine = ema(macdLine.slice(slow - 1), signal);
  const offset = slow - 1;
  const histogram = macdLine.slice(offset).map((m, i) =>
    i < signal - 1 ? 0 : m - (signalLine[i] || 0)
  );
  return { macdLine, signalLine, histogram, offset };
}

// Default crypto pairs to scan
const DEFAULT_PAIRS = [
  "BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD",
  "DOGE/USD", "SHIB/USD", "LTC/USD", "LINK/USD",
  "XRP/USD", "ADA/USD", "DOT/USD", "UNI/USD",
  "MATIC/USD", "AAVE/USD", "BCH/USD"
];

export default async (req) => {
  try {
    const url = new URL(req.url);
    const pairsParam = url.searchParams.get("pairs");
    const pairs = pairsParam ? pairsParam.split(",") : DEFAULT_PAIRS;
    const timeframe = url.searchParams.get("timeframe") || "1Hour";
    const lookback = parseInt(url.searchParams.get("lookback") || "100");

    const results = [];

    for (const pair of pairs) {
      try {
        const symbol = pair.replace("/", "");
        // Fetch bars from Alpaca data API
        const barsResp = await getCryptoBars(symbol, timeframe, lookback);
        const barData = barsResp?.bars?.[symbol];

        if (!barData || barData.length < 30) {
          results.push({ pair, signal: "NO_DATA", score: 0, error: "Insufficient bar data" });
          continue;
        }

        const closes = barData.map(b => b.c);
        const volumes = barData.map(b => b.v);
        const highs = barData.map(b => b.h);
        const lows = barData.map(b => b.l);

        // Calculate indicators
        const rsiValues = rsi(closes);
        const currentRsi = rsiValues[rsiValues.length - 1];
        const prevRsi = rsiValues[rsiValues.length - 2];
        const macdResult = macd(closes);
        const lastMacd = macdResult.macdLine[macdResult.macdLine.length - 1];
        const lastSignal = macdResult.signalLine[macdResult.signalLine.length - 1];
        const prevMacd = macdResult.macdLine[macdResult.macdLine.length - 2];
        const prevSignal = macdResult.signalLine[macdResult.signalLine.length - 2];
        const currentPrice = closes[closes.length - 1];
        const avgVolume = sma(volumes, 20);
        const currentVolume = volumes[volumes.length - 1];
        const avgVol = avgVolume[avgVolume.length - 1] || 1;
        const volumeRatio = currentVolume / avgVol;

        // Volatility: simplified ATR
        const dailyReturns = closes.slice(1).map((c, i) => (c - closes[i]) / closes[i]);
        const recentReturns = dailyReturns.slice(-24);
        const avgReturn = recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length;
        const volatility = Math.sqrt(recentReturns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / recentReturns.length);
        const dailyVolPct = volatility * 100;

        // Price change percentages
        const change1h = ((currentPrice - closes[closes.length - 2]) / closes[closes.length - 2]) * 100;
        const change24h = ((currentPrice - closes[Math.max(0, closes.length - 24)]) / closes[Math.max(0, closes.length - 24)]) * 100;

        // Signal scoring system (0-100)
        let score = 50; // neutral baseline
        let signals = [];

        // RSI signals
        if (currentRsi < 30) { score += 20; signals.push("RSI_OVERSOLD"); }
        else if (currentRsi < 40) { score += 10; signals.push("RSI_LOW"); }
        else if (currentRsi > 70) { score -= 20; signals.push("RSI_OVERBOUGHT"); }
        else if (currentRsi > 60) { score -= 5; signals.push("RSI_HIGH"); }

        // RSI diverging from oversold
        if (prevRsi < 30 && currentRsi > prevRsi) { score += 10; signals.push("RSI_BOUNCE"); }

        // MACD crossover
        if (lastMacd > lastSignal && prevMacd <= prevSignal) { score += 15; signals.push("MACD_CROSS_UP"); }
        else if (lastMacd < lastSignal && prevMacd >= prevSignal) { score -= 15; signals.push("MACD_CROSS_DOWN"); }
        else if (lastMacd > lastSignal) { score += 5; signals.push("MACD_BULLISH"); }
        else { score -= 5; signals.push("MACD_BEARISH"); }

        // Volume spike
        if (volumeRatio > 2) { score += 10; signals.push("VOLUME_SPIKE"); }
        else if (volumeRatio > 1.5) { score += 5; signals.push("VOLUME_ABOVE_AVG"); }

        // Volatility filter: need enough vol for 2-8% target but not too much
        if (dailyVolPct >= 2 && dailyVolPct <= 8) { score += 10; signals.push("VOL_IN_RANGE"); }
        else if (dailyVolPct > 8) { score -= 5; signals.push("VOL_TOO_HIGH"); }
        else { score -= 5; signals.push("VOL_TOO_LOW"); }

        // Momentum
        if (change24h > 2) { score += 5; signals.push("MOMENTUM_UP"); }
        else if (change24h < -2) { score += 5; signals.push("OVERSOLD_DIP"); }

        // Clamp score
        score = Math.max(0, Math.min(100, score));

        // Determine overall signal
        let signal;
        if (score >= 70) signal = "STRONG_BUY";
        else if (score >= 60) signal = "BUY";
        else if (score >= 45) signal = "NEUTRAL";
        else if (score >= 30) signal = "SELL";
        else signal = "STRONG_SELL";

        results.push({
          pair,
          price: currentPrice,
          change1h: change1h.toFixed(2),
          change24h: change24h.toFixed(2),
          rsi: currentRsi?.toFixed(1),
          macdStatus: lastMacd > lastSignal ? "bullish" : "bearish",
          macdCrossover: (lastMacd > lastSignal && prevMacd <= prevSignal) ? "bullish_cross" :
            (lastMacd < lastSignal && prevMacd >= prevSignal) ? "bearish_cross" : "none",
          volumeRatio: volumeRatio?.toFixed(2),
          volatility: dailyVolPct?.toFixed(1),
          score,
          signal,
          signals: signals.join(", "),
          dailyTarget: dailyVolPct >= 2 && dailyVolPct <= 8 ? "YES" : "NO"
        });

      } catch (err) {
        results.push({ pair, signal: "ERROR", score: 0, error: err.message });
      }
    }

    // Sort by score descending
    results.sort((a, b) => (b.score || 0) - (a.score || 0));

    return new Response(JSON.stringify({
      timestamp: new Date().toISOString(),
      scanResults: results,
      pairsScanned: results.length
    }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

// Netlify function config
# No path config - routed via netlify.toml redirects;
