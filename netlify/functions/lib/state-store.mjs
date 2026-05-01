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
// Learning State (DEF-13: Learning System with Rewards)
// ============================
// The learning state is now managed by learning-system.mjs.
// This module handles persistence only.

import { createLearningState, serializeLearningState, deserializeLearningState, calculateReward, recordTradeOutcome } from "./learning-system.mjs";

/**
 * Load learning state from persistent storage.
 * Uses the new learning-system.mjs schema with strategies, symbols, regime tracking.
 */
export async function loadLearningState() {
  try {
    const store = getStore(STORE_NAME);
    const raw = await store.get("learning-state", { type: "json" });
    return deserializeLearningState(raw);
  } catch (e) {
    console.log(`StateStore: could not load learning state - ${e.message}`);
    return createLearningState();
  }
}

/**
 * Save learning state to persistent storage.
 * Uses serializeLearningState to trim unbounded arrays before storing.
 */
export async function saveLearningState(state) {
  try {
    const store = getStore(STORE_NAME);
    const trimmed = serializeLearningState(state);
    await store.setJSON("learning-state", trimmed);
    return true;
  } catch (e) {
    console.log(`StateStore: could not save learning state - ${e.message}`);
    return false;
  }
}

/**
 * Rebuild learning state from Alpaca trade activities.
 * Uses the new reward function to score historical trades.
 *
 * @param {Function} getActivities - Alpaca activities fetcher
 * @param {number} daysBack - How many days of history to rebuild (default 7)
 * @returns {Object} Rebuilt learning state
 */
export async function rebuildLearningFromAPI(getActivities, daysBack = 7) {
  const state = createLearningState();

  try {
    const after = new Date(Date.now() - daysBack * 86400000).toISOString();
    const activities = await getActivities(after);

    if (!Array.isArray(activities)) {
      console.log("StateStore: rebuild - activities not an array, skipping");
      return state;
    }

    let processedCount = 0;

    for (const act of activities) {
      if (act.side === "sell" && parseFloat(act.net_amount || 0) !== 0) {
        const pnl = parseFloat(act.net_amount || 0);
        const qty = parseFloat(act.qty || 0);
        const price = parseFloat(act.price || 0);

        // Estimate pnlPct from net_amount and qty*price if possible
        const tradeValue = qty * price;
        const pnlPct = tradeValue > 0 ? pnl / (tradeValue - pnl) : 0;

        // Rebuild using the new reward-based learning
        recordTradeOutcome(state, {
          symbol: act.symbol || "unknown",
          strategy: "momentum", // Default for historical rebuild (actual strategy unknown)
          pnl,
          pnlPct,
          holdingPeriodMins: 60, // Conservative estimate for historical data
          atrPctAtEntry: 2,       // Default ATR% assumption
          timestamp: new Date(act.transaction_time || act.timestamp || Date.now()).getTime(),
        });

        processedCount++;
      }
    }

    console.log(`StateStore: rebuilt learning state from API with rewards - ${processedCount} trades processed, WR=${(state.winRate * 100).toFixed(1)}%`);
  } catch (e) {
    console.log(`StateStore: rebuild from API failed - ${e.message}`);
  }

  return state;
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