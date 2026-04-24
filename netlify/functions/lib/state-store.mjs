// Persistent State Store for Trading Bot
// Uses Netlify Blobs (already a project dependency) for zero-ops, zero-cost persistence
// Survives cold starts, serverless function restarts, and deployments
//
// Design decisions:
// - Netlify Blobs: already used by health-store.mjs, zero additional infra, free tier generous
// - Alpaca activities API used to REBUILD learning state (trade outcomes) on cold start
// - Bot operational state (daily trade count, peak equity) persisted to Blobs
// - Learning state (adaptive params, win/loss counts) persisted to Blobs AND rebuilt from API
//
// Storage keys:
//   bot-state     -> operational state (lastRun, totalTrades, dailyTradeCount, peakEquity, etc.)
//   learning-state -> adaptive parameters, win/loss counts, recent trade outcomes
//   position-log  -> historical position tracking for P&L analytics

import { getStore } from "@netlify/blobs";

const STORE_NAME = "bot-state";

// ============================
// Bot Operational State
// ============================

const DEFAULT_BOT_STATE = {
  lastRun: null,
  totalTrades: 0,
  totalPnl: 0,
  runHistory: [],
  peakEquity: 0,
  dailyTradeCount: 0,
  dailyResetDate: null,
  lastKnownPositions: [],
  dailyStats: {
    date: null,
    startingEquity: null,
    tradesPlaced: 0,
    pnl: 0,
  },
};

/**
 * Load bot operational state from persistent storage.
 * Falls back to defaults on cold start (no saved state yet).
 * Merges with defaults to handle schema evolution gracefully.
 */
export async function loadBotState() {
  try {
    const store = getStore(STORE_NAME);
    const raw = await store.get("bot-state", { type: "json" });
    if (!raw) {
      return { ...DEFAULT_BOT_STATE };
    }
    // Merge with defaults to handle any new fields added in code updates
    return { ...DEFAULT_BOT_STATE, ...raw };
  } catch (e) {
    console.log(`StateStore: could not load bot state - ${e.message}`);
    return { ...DEFAULT_BOT_STATE };
  }
}

/**
 * Save bot operational state to persistent storage.
 * Called at the end of each trading cycle.
 */
export async function saveBotState(state) {
  try {
    const store = getStore(STORE_NAME);
    // Keep only last 100 run history entries to prevent unbounded growth
    const trimmed = {
      ...state,
      runHistory: (state.runHistory || []).slice(-100),
      lastKnownPositions: (state.lastKnownPositions || []).slice(-50),
    };
    await store.setJSON("bot-state", trimmed);
    return true;
  } catch (e) {
    console.log(`StateStore: could not save bot state - ${e.message}`);
    return false;
  }
}

// ============================
// Learning State (Adaptive Parameters)
// ============================

const DEFAULT_LEARNING_STATE = {
  tradeHistory: [],
  adaptiveParams: {
    rsiOversold: 35,
    rsiOverbought: 65,
    signalThreshold: 0.22,
    scalpThreshold: 0.15,
    volumeMultiplier: 1.2,
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

/**
 * Load learning state from persistent storage.
 * This replaces the in-memory learningState in strategy.mjs.
 */
export async function loadLearningState() {
  try {
    const store = getStore(STORE_NAME);
    const raw = await store.get("learning-state", { type: "json" });
    if (!raw) {
      return { ...DEFAULT_LEARNING_STATE, adaptiveParams: { ...DEFAULT_LEARNING_STATE.adaptiveParams } };
    }
    // Deep merge to handle new adaptive params added in code updates
    return {
      ...DEFAULT_LEARNING_STATE,
      ...raw,
      adaptiveParams: { ...DEFAULT_LEARNING_STATE.adaptiveParams, ...(raw.adaptiveParams || {}) },
    };
  } catch (e) {
    console.log(`StateStore: could not load learning state - ${e.message}`);
    return { ...DEFAULT_LEARNING_STATE, adaptiveParams: { ...DEFAULT_LEARNING_STATE.adaptiveParams } };
  }
}

/**
 * Save learning state to persistent storage.
 * Called whenever trade outcomes are recorded or parameters are adapted.
 */
export async function saveLearningState(state) {
  try {
    const store = getStore(STORE_NAME);
    // Keep only last 500 trade history entries
    const trimmed = {
      ...state,
      tradeHistory: (state.tradeHistory || []).slice(-500),
    };
    await store.setJSON("learning-state", trimmed);
    return true;
  } catch (e) {
    console.log(`StateStore: could not save learning state - ${e.message}`);
    return false;
  }
}

// ============================
// State Rebuild from Alpaca API
// ============================

/**
 * Rebuild learning state from Alpaca trade activities.
 * This is the recovery mechanism: if persistent state is missing or stale,
 * we can reconstruct win/loss counts and recent trade history from the
 * Alpaca activities API, which is the authoritative source of truth.
 *
 * @param {Function} getActivities - Alpaca activities fetcher
 * @param {number} daysBack - How many days of history to rebuild (default 7)
 * @returns {Object} Rebuilt learning state
 */
export async function rebuildLearningFromAPI(getActivities, daysBack = 7) {
  const state = { ...DEFAULT_LEARNING_STATE, adaptiveParams: { ...DEFAULT_LEARNING_STATE.adaptiveParams } };

  try {
    const after = new Date(Date.now() - daysBack * 86400000).toISOString();
    const activities = await getActivities(after);

    if (!Array.isArray(activities)) {
      console.log("StateStore: rebuild - activities not an array, skipping");
      return state;
    }

    let wins = 0;
    let losses = 0;
    const tradeHistory = [];

    for (const act of activities) {
      if (act.side === "sell" && parseFloat(act.net_amount || 0) !== 0) {
        const pnl = parseFloat(act.net_amount || 0);
        if (pnl > 0) wins++;
        else losses++;

        tradeHistory.push({
          symbol: act.symbol || "unknown",
          signal: "sell_close",
          pnl,
          timestamp: new Date(act.transaction_time || act.timestamp || Date.now()).getTime(),
        });
      }
    }

    state.totalWins = wins;
    state.totalLosses = losses;
    state.winRate = (wins + losses) > 0 ? wins / (wins + losses) : 0.5;
    state.tradeHistory = tradeHistory.slice(-500);
    state.lastAdaptation = new Date().toISOString();

    // Adapt parameters based on rebuilt win rate
    adaptParametersFromState(state);

    console.log(`StateStore: rebuilt learning state from API - ${wins}W/${losses}L, winRate=${state.winRate.toFixed(2)}`);
  } catch (e) {
    console.log(`StateStore: rebuild from API failed - ${e.message}`);
  }

  return state;
}

/**
 * Adapt parameters based on current win rate.
 * Extracted from strategy.mjs to work on a state object.
 */
function adaptParametersFromState(state) {
  const recent = state.tradeHistory.slice(-50);
  if (recent.length < 10) return;

  const recentWins = recent.filter(t => t.pnl > 0).length;
  const recentWinRate = recentWins / recent.length;
  const params = state.adaptiveParams;

  if (recentWinRate > 0.6) {
    params.signalThreshold = Math.max(0.12, params.signalThreshold - 0.015);
    params.scalpThreshold = Math.max(0.08, params.scalpThreshold - 0.01);
    params.rsiOversold = Math.min(42, params.rsiOversold + 1);
    params.rsiOverbought = Math.max(58, params.rsiOverbought - 1);
  } else if (recentWinRate < 0.4) {
    params.signalThreshold = Math.min(0.4, params.signalThreshold + 0.02);
    params.scalpThreshold = Math.min(0.25, params.scalpThreshold + 0.015);
    params.rsiOversold = Math.max(25, params.rsiOversold - 1);
    params.rsiOverbought = Math.min(75, params.rsiOverbought + 1);
  }

  state.lastAdaptation = new Date().toISOString();
}

// ============================
// Position Tracking
// ============================

/**
 * Save a snapshot of current positions for change detection.
 * Useful for detecting new positions, closed positions, and P&L between runs.
 */
export async function savePositionSnapshot(positions) {
  try {
    const store = getStore(STORE_NAME);
    const snapshot = {
      timestamp: new Date().toISOString(),
      positions: (positions || []).map(p => ({
        symbol: p.symbol,
        qty: p.qty,
        avgEntryPrice: p.avg_entry_price,
        currentPrice: p.current_price,
        marketValue: p.market_value,
        unrealizedPnl: p.unrealized_pl,
        unrealizedPnlPct: p.unrealized_plpc,
      })),
    };
    await store.setJSON("position-snapshot", snapshot);
    return true;
  } catch (e) {
    console.log(`StateStore: could not save position snapshot - ${e.message}`);
    return false;
  }
}

/**
 * Load last known positions snapshot.
 */
export async function loadPositionSnapshot() {
  try {
    const store = getStore(STORE_NAME);
    return await store.get("position-snapshot", { type: "json" });
  } catch (e) {
    console.log(`StateStore: could not load position snapshot - ${e.message}`);
    return null;
  }
}

// ============================
// Position Strategy Metadata
// ============================

/**
 * Save position strategy metadata (which strategy opened each position).
 * Used by risk-manager to apply strategy-specific SL/TP.
 */
export async function savePositionMeta(symbol, strategy) {
  try {
    const store = getStore(STORE_NAME);
    const raw = await store.get("position-meta", { type: "json" });
    const meta = raw || {};
    meta[symbol] = strategy;
    await store.setJSON("position-meta", meta);
    return true;
  } catch (e) {
    console.log(`StateStore: could not save position meta - ${e.message}`);
    return false;
  }
}

export async function loadPositionMeta() {
  try {
    const store = getStore(STORE_NAME);
    return await store.get("position-meta", { type: "json" }) || {};
  } catch (e) {
    console.log(`StateStore: could not load position meta - ${e.message}`);
    return {};
  }
}

// ============================
// Atomic State Updates
// ============================

/**
 * Atomically increment the daily trade counter.
 * Prevents race conditions between concurrent cron runs.
 * Returns the updated state.
 */
export async function incrementDailyTradeCount() {
  const state = await loadBotState();
  const today = new Date().toISOString().slice(0, 10);

  // Reset daily counter if date changed
  if (state.dailyResetDate !== today) {
    state.dailyTradeCount = 0;
    state.dailyResetDate = today;
  }

  state.dailyTradeCount++;
  await saveBotState(state);
  return state;
}

/**
 * Add a run record to the history.
 */
export async function recordBotRun(runData) {
  const state = await loadBotState();
  state.lastRun = runData.time || new Date().toISOString();
  state.runHistory.push(runData);
  state.runHistory = state.runHistory.slice(-100);
  await saveBotState(state);
  return state;
}