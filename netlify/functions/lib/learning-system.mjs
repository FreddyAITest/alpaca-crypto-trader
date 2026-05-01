// Learning System with Rewards - DEF-13
// Replaces the ad-hoc learningState in strategy.mjs with a proper RL-inspired system:
// 1. Reward function: risk-adjusted return (Sharpe-like), not binary win/loss
// 2. Per-strategy performance tracking with confidence scoring
// 3. Per-symbol performance tracking with automatic blacklisting
// 4. Time-decayed weighting (exponential decay, half-life ~48h)
// 5. Market regime detection (trending/ranging/volatile)
// 6. Exploration vs exploitation (epsilon-greedy parameter search)

// ============================================================
// REWARD FUNCTION
// ============================================================

/**
 * Calculate the reward for a completed trade.
 * Uses risk-adjusted return: scales PnL% by the inverse of volatility during the hold period,
 * rewarding trades that capture clean moves and penalizing those that survived high volatility.
 *
 * Reward formula:
 *   rawReturn = pnlPct / maxHoldingPeriodHours
 *   riskAdjustment = 1 / (1 + atrPctAtEntry)
 *   reward = rawReturn * riskAdjustment * scaleFactor
 *
 * Positive reward = good trade (captured return efficiently)
 * Negative reward = bad trade (lost money or held too long for the return)
 *
 * @param {number} pnl - Realized P&L in dollars
 * @param {number} pnlPct - Realized P&L as decimal (0.02 = 2%)
 * @param {number} holdingPeriodMins - How long the position was held
 * @param {number} atrPctAtEntry - ATR as % of price at entry time
 * @param {number} maxFavorablePnlPct - Max favorable excursion during hold (optional)
 * @returns {number} reward score
 */
export function calculateReward(pnl, pnlPct, holdingPeriodMins, atrPctAtEntry = 0, maxFavorablePnlPct = null) {
  const holdingHours = Math.max(holdingPeriodMins / 60, 0.02); // min 1.2 min to avoid division by tiny numbers

  // Annualized return approximation
  const rawReturn = pnlPct / holdingHours;

  // Risk adjustment: lower reward for trades taken in high volatility
  const riskAdjustment = 1 / (1 + (atrPctAtEntry || 2));

  // Scale to a reasonable range
  let reward = rawReturn * riskAdjustment * 10;

  // Bonus: if we captured most of the max favorable move, add a small bonus
  if (maxFavorablePnlPct !== null && pnlPct > 0 && maxFavorablePnlPct > 0) {
    const captureRatio = pnlPct / maxFavorablePnlPct;
    if (captureRatio > 0.7) {
      reward *= 1.0 + (captureRatio - 0.7) * 0.5; // Up to 15% bonus for perfect capture
    }
  }

  // Penalty: if we held too long for a small gain (inefficient capital use)
  if (Math.abs(pnlPct) < 0.005 && holdingHours > 4) {
    reward *= 0.5;
  }

  return reward;
}

// ============================================================
// TIME DECAY
// ============================================================

/**
 * Exponential time decay weight.
 * halfLifeHours = 48 means a trade from 48h ago has weight 0.5.
 */
const DECAY_HALF_LIFE_HOURS = 48;

export function timeDecayWeight(timestamp, now = Date.now()) {
  const ageHours = (now - timestamp) / (1000 * 60 * 60);
  return Math.pow(0.5, ageHours / DECAY_HALF_LIFE_HOURS);
}

// ============================================================
// LEARNING STATE
// ============================================================

/**
 * Creates a fresh learning state object.
 */
export function createLearningState() {
  return {
    // Per-strategy stats
    strategies: {
      momentum: createStrategyStats(),
      scalp: createStrategyStats(),
      "mean-reversion": createStrategyStats(),
      "stock-momentum": createStrategyStats(),
    },

    // Per-symbol stats
    symbols: {},

    // Adaptive parameters (same shape as old system for compatibility)
    adaptiveParams: {
      rsiOversold: 40,
      rsiOverbought: 60,
      signalThreshold: 0.14,
      scalpThreshold: 0.08,
      volumeMultiplier: 0.8,
      emaFastPeriod: 8,
      emaSlowPeriod: 21,
      stochOverbought: 80,
      stochOversold: 20,
    },

    // Global stats
    totalTrades: 0,
    totalReward: 0,
    averageReward: 0,
    winRate: 0.5,
    totalWins: 0,
    totalLosses: 0,

    // Market regime
    currentRegime: "unknown",
    regimeHistory: [],

    // Exploration
    explorationRate: 0.1,
    lastAdaptation: null,
    adaptationGeneration: 0,
  };
}

function createStrategyStats() {
  return {
    trades: 0,
    wins: 0,
    losses: 0,
    totalPnl: 0,
    totalPnlPct: 0,
    totalReward: 0,
    averageReward: 0,
    winRate: 0.5,
    // Track best-performing parameter ranges for this strategy
    bestRsiRange: null,
    bestVolumeRegime: null,
    confidence: 0.5,
  };
}

// ============================================================
// RECORD TRADE OUTCOME
// ============================================================

/**
 * Record a completed trade and update all learning statistics.
 * This is the main entry point for learning from trade outcomes.
 *
 * @param {Object} state - The learning state object
 * @param {Object} trade - Trade outcome data
 * @param {string} trade.symbol - Trading pair
 * @param {string} trade.strategy - Which strategy generated the signal
 * @param {number} trade.pnl - Realized P&L in dollars
 * @param {number} trade.pnlPct - Realized P&L as decimal
 * @param {number} trade.holdingPeriodMins - Hold duration
 * @param {number} trade.atrPctAtEntry - ATR% at entry
 * @param {number} trade.maxFavorablePnlPct - Max favorable excursion
 * @param {number} trade.entryRsi - RSI at entry
 * @param {number} trade.entryPrice - Entry price
 * @param {number} trade.exitPrice - Exit price
 * @param {number} trade.timestamp - Trade open time (ms)
 */
export function recordTradeOutcome(state, trade) {
  const now = Date.now();
  const strategy = trade.strategy || "momentum";

  // Calculate reward
  const reward = calculateReward(
    trade.pnl || 0,
    trade.pnlPct || 0,
    trade.holdingPeriodMins || 0,
    trade.atrPctAtEntry || 0,
    trade.maxFavorablePnlPct || null
  );

  // Update global stats
  state.totalTrades++;
  state.totalReward += reward;
  state.averageReward = state.totalReward / state.totalTrades;

  if (trade.pnl > 0) {
    state.totalWins++;
  } else {
    state.totalLosses++;
  }
  state.winRate = state.totalWins / (state.totalWins + state.totalLosses);

  // Update per-strategy stats
  if (!state.strategies[strategy]) {
    state.strategies[strategy] = createStrategyStats();
  }
  const strat = state.strategies[strategy];
  strat.trades++;
  if (trade.pnl > 0) strat.wins++;
  else strat.losses++;
  strat.totalPnl += trade.pnl || 0;
  strat.totalPnlPct += trade.pnlPct || 0;
  strat.totalReward += reward;
  strat.averageReward = strat.totalReward / strat.trades;
  strat.winRate = strat.wins / (strat.wins + strat.losses);

  // Update per-symbol stats
  if (!state.symbols[trade.symbol]) {
    state.symbols[trade.symbol] = createSymbolStats();
  }
  const sym = state.symbols[trade.symbol];
  sym.trades++;
  if (trade.pnl > 0) sym.wins++;
  else sym.losses++;
  sym.totalPnl += trade.pnl || 0;
  sym.totalPnlPct += trade.pnlPct || 0;
  sym.totalReward += reward;
  sym.averageReward = sym.totalReward / sym.trades;
  sym.winRate = sym.wins / (sym.wins + sym.losses);
  sym.lastTradeTime = now;
  sym.strategiesUsed[strategy] = (sym.strategiesUsed[strategy] || 0) + 1;

  // Track RSI range performance for this strategy
  if (trade.entryRsi !== undefined) {
    if (!strat.bestRsiRange) {
      strat.bestRsiRange = { rsi: trade.entryRsi, reward };
    } else if (reward > strat.bestRsiRange.reward) {
      strat.bestRsiRange = { rsi: trade.entryRsi, reward };
    }
  }

  // Decay old trade contributions (approximate: re-average with decay)
  decayAndUpdateConfidence(state, now);

  // Adapt parameters based on new information
  adaptParameters(state);

  return { reward, strategy, symbol: trade.symbol };
}

function createSymbolStats() {
  return {
    trades: 0,
    wins: 0,
    losses: 0,
    totalPnl: 0,
    totalPnlPct: 0,
    totalReward: 0,
    averageReward: 0,
    winRate: 0.5,
    lastTradeTime: 0,
    strategiesUsed: {},
    blacklisted: false,
    blacklistReason: null,
  };
}

// ============================================================
// CONFIDENCE SCORING
// ============================================================

/**
 * Update strategy confidence scores using time-decayed reward history.
 * Confidence = weighted average of recent rewards, normalized to [0, 1].
 */
function decayAndUpdateConfidence(state, now) {
  for (const strat of Object.values(state.strategies)) {
    if (strat.trades < 3) {
      strat.confidence = 0.5; // Neutral for insufficient data
      continue;
    }

    // Confidence based on win rate and reward consistency
    const winRateComponent = strat.winRate;
    const rewardComponent = sigmoid(strat.averageReward); // Map reward to [0, 1]

    strat.confidence = winRateComponent * 0.6 + rewardComponent * 0.4;
  }

  // Update per-symbol blacklist status
  for (const [symbol, sym] of Object.entries(state.symbols)) {
    if (sym.trades >= 5 && sym.winRate < 0.25 && sym.averageReward < -0.5) {
      sym.blacklisted = true;
      sym.blacklistReason = `Low performance: ${(sym.winRate * 100).toFixed(0)}% WR, reward ${sym.averageReward.toFixed(2)}`;
    } else if (sym.trades >= 10 && sym.winRate > 0.6 && sym.averageReward > 0.3) {
      // Auto-unblacklist if performance improves
      sym.blacklisted = false;
      sym.blacklistReason = null;
    }
  }
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

// ============================================================
// PARAMETER ADAPTATION
// ============================================================

/**
 * Adapt strategy parameters based on learning state.
 * Uses a more sophisticated approach than the old binary threshold adjustment:
 * - Considers per-strategy performance
 * - Uses reward magnitude, not just win/loss count
 * - Adds exploration noise to escape local optima
 * - Adjusts based on market regime
 */
export function adaptParameters(state) {
  state.adaptationGeneration++;

  // Calculate time-decayed aggregate performance
  const allStrats = Object.values(state.strategies);
  const totalTrades = allStrats.reduce((s, st) => s + st.trades, 0);

  if (totalTrades < 10) return; // Not enough data

  // Weighted average reward across strategies
  const weightedReward = allStrats.reduce((sum, st) => sum + st.averageReward * st.trades, 0) / totalTrades;

  const params = state.adaptiveParams;

  // Exploration: occasionally perturb parameters randomly
  const explore = Math.random() < state.explorationRate;

  if (explore) {
    // Random exploration step
    params.signalThreshold = clamp(
      params.signalThreshold + (Math.random() - 0.5) * 0.06,
      0.08, 0.45
    );
    params.scalpThreshold = clamp(
      params.scalpThreshold + (Math.random() - 0.5) * 0.04,
      0.04, 0.30
    );
    params.volumeMultiplier = clamp(
      params.volumeMultiplier + (Math.random() - 0.5) * 0.3,
      0.5, 2.0
    );
    params.rsiOversold = Math.round(clamp(
      params.rsiOversold + (Math.random() - 0.5) * 6,
      20, 48
    ));
    params.rsiOverbought = Math.round(clamp(
      params.rsiOverbought + (Math.random() - 0.5) * 6,
      52, 80
    ));
  } else {
    // Exploitation: gradient-based adjustment
    const adjustmentStep = 0.01;

    if (weightedReward > 0.3) {
      // Doing well — make thresholds slightly more lenient to find more opportunities
      params.signalThreshold = clamp(params.signalThreshold - adjustmentStep * 1.5, 0.08, 0.45);
      params.scalpThreshold = clamp(params.scalpThreshold - adjustmentStep, 0.04, 0.30);
      params.volumeMultiplier = clamp(params.volumeMultiplier - 0.05, 0.5, 2.0);
    } else if (weightedReward < -0.3) {
      // Doing poorly — tighten thresholds
      params.signalThreshold = clamp(params.signalThreshold + adjustmentStep * 2, 0.08, 0.45);
      params.scalpThreshold = clamp(params.scalpThreshold + adjustmentStep * 1.5, 0.04, 0.30);
      params.volumeMultiplier = clamp(params.volumeMultiplier + 0.1, 0.5, 2.0);
    }

    // Per-strategy RSI adjustments
    const momentumStrat = state.strategies["momentum"];
    const scalpStrat = state.strategies["scalp"];
    const mrStrat = state.strategies["mean-reversion"];

    if (momentumStrat && momentumStrat.trades >= 5) {
      if (momentumStrat.averageReward > 0.3) {
        params.rsiOversold = Math.min(45, params.rsiOversold + 1);
        params.rsiOverbought = Math.max(55, params.rsiOverbought - 1);
      } else if (momentumStrat.averageReward < -0.3) {
        params.rsiOversold = Math.max(22, params.rsiOversold - 1);
        params.rsiOverbought = Math.min(78, params.rsiOverbought + 1);
      }
    }

    if (mrStrat && mrStrat.trades >= 5) {
      // Mean-reversion needs wider RSI extremes — adjust stoch thresholds
      if (mrStrat.averageReward > 0.3) {
        params.stochOversold = Math.max(15, params.stochOversold - 1);
        params.stochOverbought = Math.min(85, params.stochOverbought + 1);
      }
    }

    // Decay exploration rate as we gain confidence
    if (state.totalTrades > 50) {
      state.explorationRate = Math.max(0.05, 0.1 * (50 / state.totalTrades));
    }
  }

  state.lastAdaptation = new Date().toISOString();
}

// ============================================================
// MARKET REGIME DETECTION
// ============================================================

/**
 * Classify the current market regime based on recent bar data.
 *
 * Regimes:
 * - "trending_up": Strong uptrend (ADX > 25, +DI > -DI, price above EMA21)
 * - "trending_down": Strong downtrend (ADX > 25, -DI > +DI, price below EMA21)
 * - "ranging": Low ADX (< 20), price oscillating around EMA21
 * - "volatile": High ATR relative to normal, ADX moderate
 * - "unknown": Insufficient data
 *
 * @param {Array} bars - OHLCV bar data
 * @returns {Object} regime classification
 */
export function detectMarketRegime(bars) {
  if (!bars || bars.length < 30) {
    return { regime: "unknown", confidence: 0, metrics: {} };
  }

  const closes = bars.map(b => b.c || b.close);

  // Calculate ADX
  const adxData = calculateADX(bars, 14);
  const lastADX = adxData.adx.length > 0 ? adxData.adx[adxData.adx.length - 1] : 0;
  const lastPlusDI = adxData.plusDI.length > 0 ? adxData.plusDI[adxData.plusDI.length - 1] : 0;
  const lastMinusDI = adxData.minusDI.length > 0 ? adxData.minusDI[adxData.minusDI.length - 1] : 0;

  // Calculate ATR ratio (current ATR / average ATR over longer period)
  const atrData = calculateATR(bars, 14);
  const lastATR = atrData.length > 0 ? atrData[atrData.length - 1] : 0;
  const avgATR = atrData.length > 10
    ? atrData.slice(-10).reduce((a, b) => a + b, 0) / 10
    : lastATR;
  const atrRatio = avgATR > 0 ? lastATR / avgATR : 1;

  // EMA 21 trend
  const ema21 = calculateEMA(closes, 21);
  const lastPrice = closes[closes.length - 1];
  const lastEMA21 = ema21[ema21.length - 1];
  const priceVsEMA = lastEMA21 ? (lastPrice - lastEMA21) / lastEMA21 : 0;

  // Recent price change (5-period)
  const priceChange5 = closes.length >= 6
    ? (closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6]
    : 0;

  let regime, confidence;

  if (lastADX > 25 && lastPlusDI > lastMinusDI && priceVsEMA > 0.01) {
    regime = "trending_up";
    confidence = Math.min(0.9, lastADX / 50);
  } else if (lastADX > 25 && lastMinusDI > lastPlusDI && priceVsEMA < -0.01) {
    regime = "trending_down";
    confidence = Math.min(0.9, lastADX / 50);
  } else if (lastADX < 20 && Math.abs(priceVsEMA) < 0.02) {
    regime = "ranging";
    confidence = Math.min(0.9, (20 - lastADX) / 20);
  } else if (atrRatio > 1.5) {
    regime = "volatile";
    confidence = Math.min(0.9, (atrRatio - 1) / 1);
  } else {
    regime = "transitional";
    confidence = 0.3;
  }

  return {
    regime,
    confidence,
    metrics: {
      adx: lastADX,
      plusDI: lastPlusDI,
      minusDI: lastMinusDI,
      atrRatio,
      priceVsEMA,
      priceChange5,
    },
  };
}

/**
 * Get the preferred strategies for a given market regime.
 * Different strategies excel in different conditions.
 */
export function getRegimeStrategies(regime) {
  switch (regime) {
    case "trending_up":
      return { primary: ["momentum"], secondary: ["scalp"], avoid: ["mean-reversion"] };
    case "trending_down":
      return { primary: [], secondary: ["scalp"], avoid: ["momentum", "mean-reversion"] };
    case "ranging":
      return { primary: ["mean-reversion", "scalp"], secondary: ["momentum"], avoid: [] };
    case "volatile":
      return { primary: ["scalp"], secondary: ["momentum"], avoid: ["mean-reversion"] };
    default:
      return { primary: ["momentum", "scalp", "mean-reversion"], secondary: [], avoid: [] };
  }
}

/**
 * Update overall market regime based on scanning multiple symbols.
 * Uses the modal regime from the top N symbols by volume/importance.
 */
export function updateMarketRegime(state, barsBySymbol, topSymbols = ["BTC/USD", "ETH/USD", "SOL/USD"]) {
  const regimeVotes = {};

  for (const sym of topSymbols) {
    const bars = barsBySymbol[sym];
    if (!bars) continue;

    const { regime } = detectMarketRegime(bars);
    regimeVotes[regime] = (regimeVotes[regime] || 0) + 1;
  }

  if (Object.keys(regimeVotes).length === 0) return;

  // Pick the regime with the most votes
  const sorted = Object.entries(regimeVotes).sort((a, b) => b[1] - a[1]);
  const dominantRegime = sorted[0][0];
  const voteCount = sorted[0][1];

  state.currentRegime = dominantRegime;
  state.regimeHistory.push({
    regime: dominantRegime,
    votes: voteCount,
    total: topSymbols.length,
    timestamp: Date.now(),
  });
  state.regimeHistory = state.regimeHistory.slice(-100);
}

// ============================================================
// SYMBOL SCORING & FILTERING
// ============================================================

/**
 * Get a sorted list of symbols ranked by their learned performance.
 * Best symbols first, blacklisted symbols excluded.
 *
 * @param {Object} state - Learning state
 * @param {Array} watchList - Full list of symbols to filter
 * @param {string} strategy - Optional: filter by strategy fit
 * @returns {Array} ranked symbols
 */
export function rankSymbols(state, watchList, strategy = null) {
  const scored = watchList
    .filter(sym => {
      const s = state.symbols[sym];
      return !s || !s.blacklisted;
    })
    .map(sym => {
      const s = state.symbols[sym];
      if (!s || s.trades < 3) {
        return { symbol: sym, score: 0.5, trades: 0, winRate: 0.5 };
      }

      // Score = weighted combination of win rate and reward
      const recency = Math.min(1, (Date.now() - s.lastTradeTime) / (7 * 86400000));
      const recencyBonus = 1 - recency * 0.3; // Recent trades get up to 30% bonus

      let score = (s.winRate * 0.5 + sigmoid(s.averageReward) * 0.5) * recencyBonus;

      // Boost if this symbol works well with the requested strategy
      if (strategy && s.strategiesUsed[strategy]) {
        const stratUseRatio = s.strategiesUsed[strategy] / s.trades;
        score *= 1 + stratUseRatio * 0.2;
      }

      return {
        symbol: sym,
        score: Math.min(1, Math.max(0, score)),
        trades: s.trades,
        winRate: s.winRate,
        averageReward: s.averageReward,
      };
    });

  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Get the list of currently blacklisted symbols.
 */
export function getBlacklistedSymbols(state) {
  return Object.entries(state.symbols)
    .filter(([, sym]) => sym.blacklisted)
    .map(([symbol, sym]) => ({ symbol, reason: sym.blacklistReason }));
}

// ============================================================
// STRATEGY WEIGHTING
// ============================================================

/**
 * Get strategy weights for signal combination, adjusted by current market regime.
 * Higher weight = more signals from this strategy will be considered.
 *
 * @param {Object} state - Learning state
 * @returns {Object} strategy weights
 */
export function getStrategyWeights(state) {
  const regime = state.currentRegime;
  const regimeStrats = getRegimeStrategies(regime);

  const weights = {};

  for (const [name, strat] of Object.entries(state.strategies)) {
    let weight = strat.confidence || 0.5;

    // Boost primary strategies for this regime
    if (regimeStrats.primary.includes(name)) {
      weight *= 1.4;
    }
    // Reduce secondary strategies
    else if (regimeStrats.secondary.includes(name)) {
      weight *= 0.8;
    }
    // Penalize strategies to avoid in this regime
    else if (regimeStrats.avoid.includes(name)) {
      weight *= 0.3;
    }

    weights[name] = Math.min(1, Math.max(0.1, weight));
  }

  return weights;
}

// ============================================================
// SIGNAL FILTERING
// ============================================================

/**
 * Apply learning-based filtering to a list of trading signals.
 * Filters out:
 * - Signals for blacklisted symbols
 * - Signals from strategies that are underperforming in current regime
 * - Low-confidence signals below the learned threshold
 *
 * @param {Object} state - Learning state
 * @param {Array} signals - Raw signals from scanSymbols
 * @returns {Array} filtered and scored signals
 */
export function filterSignals(state, signals) {
  const strategyWeights = getStrategyWeights(state);
  const regimeStrats = getRegimeStrategies(state.currentRegime);

  return signals
    .filter(signal => {
      // Filter blacklisted symbols
      const sym = state.symbols[signal.symbol];
      if (sym && sym.blacklisted) return false;

      // Filter strategies to avoid in this regime
      if (regimeStrats.avoid.includes(signal.strategy)) {
        // Only allow if signal is very strong (> 0.85)
        if (signal.strength < 0.85) return false;
      }

      return true;
    })
    .map(signal => {
      const baseWeight = strategyWeights[signal.strategy] || 0.5;

      // Adjust signal strength by strategy weight
      const adjustedStrength = signal.strength * baseWeight;

      // Boost if the symbol has a good track record
      const sym = state.symbols[signal.symbol];
      let symbolBoost = 1.0;
      if (sym && sym.trades >= 3) {
        symbolBoost = 0.8 + sym.winRate * 0.4; // Range [0.8, 1.2]
      }

      return {
        ...signal,
        adjustedStrength: Math.min(1, adjustedStrength * symbolBoost),
        strategyConfidence: baseWeight,
        symbolScore: sym ? sym.winRate : 0.5,
        filtered: false,
      };
    })
    .sort((a, b) => b.adjustedStrength - a.adjustedStrength);
}

// ============================================================
// LEARNING SUMMARY (for dashboard/API responses)
// ============================================================

/**
 * Get a summary of the learning system for API responses and dashboard.
 */
export function getLearningSummary(state) {
  const blacklisted = getBlacklistedSymbols(state);
  const strategyWeights = getStrategyWeights(state);

  // Top performing symbols
  const topSymbols = Object.entries(state.symbols)
    .filter(([, s]) => s.trades >= 3 && !s.blacklisted)
    .sort(([, a], [, b]) => b.averageReward - a.averageReward)
    .slice(0, 10)
    .map(([symbol, s]) => ({
      symbol,
      trades: s.trades,
      winRate: s.winRate,
      averageReward: s.averageReward,
    }));

  return {
    totalTrades: state.totalTrades,
    winRate: state.winRate,
    averageReward: state.averageReward,
    currentRegime: state.currentRegime,
    adaptationGeneration: state.adaptationGeneration,
    explorationRate: state.explorationRate,
    strategies: Object.fromEntries(
      Object.entries(state.strategies).map(([name, s]) => [
        name,
        { trades: s.trades, winRate: s.winRate, confidence: s.confidence, averageReward: s.averageReward },
      ])
    ),
    strategyWeights,
    topSymbols,
    blacklistedCount: blacklisted.length,
    blacklisted: blacklisted.slice(0, 5),
    adaptiveParams: state.adaptiveParams,
    lastAdaptation: state.lastAdaptation,
  };
}

// ============================================================
// SERIALIZATION HELPERS
// ============================================================

/**
 * Prepare learning state for serialization to Netlify Blobs.
 * Trims unbounded arrays to prevent storage bloat.
 */
export function serializeLearningState(state) {
  const maxRegimeHistory = 100;
  const maxSymbolsToKeep = 200;

  // Prune old symbol data (keep most recent/most traded)
  const symbolEntries = Object.entries(state.symbols)
    .sort(([, a], [, b]) => b.trades - a.trades)
    .slice(0, maxSymbolsToKeep);

  return {
    ...state,
    regimeHistory: (state.regimeHistory || []).slice(-maxRegimeHistory),
    symbols: Object.fromEntries(symbolEntries),
  };
}

/**
 * Deserialize and merge with defaults (handles schema evolution).
 */
export function deserializeLearningState(raw) {
  const fresh = createLearningState();
  if (!raw) return fresh;

  // Deep merge strategies
  for (const [name, stratDefaults] of Object.entries(fresh.strategies)) {
    fresh.strategies[name] = { ...stratDefaults, ...(raw.strategies?.[name] || {}) };
  }
  // Add any new strategies from raw data
  for (const [name, stratData] of Object.entries(raw.strategies || {})) {
    if (!fresh.strategies[name]) {
      fresh.strategies[name] = { ...createStrategyStats(), ...stratData };
    }
  }

  // Merge symbols
  fresh.symbols = { ...raw.symbols || {} };

  // Merge top-level fields
  fresh.totalTrades = raw.totalTrades ?? fresh.totalTrades;
  fresh.totalReward = raw.totalReward ?? fresh.totalReward;
  fresh.averageReward = raw.averageReward ?? fresh.averageReward;
  fresh.winRate = raw.winRate ?? fresh.winRate;
  fresh.totalWins = raw.totalWins ?? fresh.totalWins;
  fresh.totalLosses = raw.totalLosses ?? fresh.totalLosses;
  fresh.currentRegime = raw.currentRegime ?? fresh.currentRegime;
  fresh.regimeHistory = raw.regimeHistory ?? fresh.regimeHistory;
  fresh.explorationRate = raw.explorationRate ?? fresh.explorationRate;
  fresh.lastAdaptation = raw.lastAdaptation ?? fresh.lastAdaptation;
  fresh.adaptationGeneration = raw.adaptationGeneration ?? fresh.adaptationGeneration;
  fresh.adaptiveParams = { ...fresh.adaptiveParams, ...(raw.adaptiveParams || {}) };

  return fresh;
}

// ============================================================
// INDICATOR HELPERS (self-contained, no circular deps)
// ============================================================

function calculateEMA(data, period) {
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

function calculateATR(bars, period = 14) {
  if (bars.length < 2) return [];
  const trValues = [];
  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].h || bars[i].high;
    const low = bars[i].l || bars[i].low;
    const prevClose = bars[i - 1].c || bars[i - 1].close;
    trValues.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
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

function calculateADX(bars, period = 14) {
  if (bars.length < period + 1) return { adx: [], plusDI: [], minusDI: [] };
  const highs = bars.map(b => b.h || b.high);
  const lows = bars.map(b => b.l || b.low);
  const closes = bars.map(b => b.c || b.close);
  const tr = [];
  const plusDM = [];
  const minusDM = [];
  for (let i = 1; i < bars.length; i++) {
    const h = highs[i] - highs[i - 1];
    const l = lows[i - 1] - lows[i];
    const atrVal = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    tr.push(atrVal);
    plusDM.push(h > l && h > 0 ? h : 0);
    minusDM.push(l > h && l > 0 ? l : 0);
  }
  let sumTR = 0, sumPlus = 0, sumMinus = 0;
  for (let i = 0; i < period; i++) { sumTR += tr[i]; sumPlus += plusDM[i]; sumMinus += minusDM[i]; }
  let atrSmoothed = sumTR, plusSmoothed = sumPlus, minusSmoothed = sumMinus;
  const adxVals = [], plusDI = [], minusDI = [];
  for (let i = period; i < tr.length; i++) {
    atrSmoothed = atrSmoothed - atrSmoothed / period + tr[i];
    plusSmoothed = plusSmoothed - plusSmoothed / period + plusDM[i];
    minusSmoothed = minusSmoothed - minusSmoothed / period + minusDM[i];
    const pDI = 100 * plusSmoothed / atrSmoothed;
    const mDI = 100 * minusSmoothed / atrSmoothed;
    const dx = (Math.abs(pDI - mDI) / (pDI + mDI)) * 100 || 0;
    adxVals.push(dx);
    plusDI.push(pDI);
    minusDI.push(mDI);
  }
  const adxSmoothed = calculateEMA(adxVals, period);
  return { adx: adxSmoothed, plusDI, minusDI };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
