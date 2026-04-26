// Health Store - Persistent bot health tracking via Netlify Blobs
// Stores cron run history, consecutive errors, and last run time
// Survives cold starts unlike in-memory botState

import { getStore } from '@netlify/blobs';

const STORE_NAME = "bot-health";
const KEY_HEALTH = "cron-health";

// Default health state
const DEFAULT_HEALTH = {
  lastRun: null,
  lastSuccess: null,
  consecutiveErrors: 0,
  totalRuns: 0,
  totalErrors: 0,
  recentRuns: [],   // last 20 runs: { time, success, error?, durationMs }
  updatedAt: null,
};

export async function getHealth() {
  try {
    const store = getStore(STORE_NAME);
    const raw = await store.get(KEY_HEALTH, { type: "json" });
    if (!raw) return { ...DEFAULT_HEALTH };
    return { ...DEFAULT_HEALTH, ...raw };
  } catch (e) {
    // Blobs not available (local dev, etc.) - return default
    console.log(`HealthStore: could not read - ${e.message}`);
    return { ...DEFAULT_HEALTH };
  }
}

export async function recordRun(result) {
  // result: { success: bool, error?: string, durationMs?: number }
  const health = await getHealth();
  const now = new Date().toISOString();

  health.lastRun = now;
  health.totalRuns++;
  health.updatedAt = now;

  if (result.success) {
    health.lastSuccess = now;
    health.consecutiveErrors = 0;
  } else {
    health.consecutiveErrors++;
    health.totalErrors++;
  }

  health.recentRuns.push({
    time: now,
    success: result.success,
    error: result.error || null,
    durationMs: result.durationMs || null,
  });
  // Keep only last 20
  health.recentRuns = health.recentRuns.slice(-20);

  try {
    const store = getStore(STORE_NAME);
    await store.setJSON(KEY_HEALTH, health);
  } catch (e) {
    console.log(`HealthStore: could not write - ${e.message}`);
  }

  return health;
}

export async function getAlerts(health) {
  const alerts = [];
  const now = Date.now();

  // Alert: 15+ minutes since last cron run
  if (health.lastRun) {
    const minutesSinceRun = (now - new Date(health.lastRun).getTime()) / 60000;
    if (minutesSinceRun > 15) {
      alerts.push({
        type: "cron_gap",
        severity: minutesSinceRun > 30 ? "critical" : "warning",
        message: `No cron run for ${Math.round(minutesSinceRun)} minutes (expected every 5 min)`,
        minutesSinceRun: Math.round(minutesSinceRun),
      });
    }
  } else {
    alerts.push({
      type: "cron_never",
      severity: "critical",
      message: "Cron has never run - no last run time recorded",
    });
  }

  // Alert: 3+ consecutive errors
  if (health.consecutiveErrors >= 3) {
    alerts.push({
      type: "consecutive_errors",
      severity: health.consecutiveErrors >= 5 ? "critical" : "warning",
      message: `${health.consecutiveErrors} consecutive errors - bot may be stuck`,
      consecutiveErrors: health.consecutiveErrors,
    });
  }

  // Alert: High error rate (over 50%)
  if (health.totalRuns >= 10 && health.totalErrors / health.totalRuns > 0.5) {
    alerts.push({
      type: "high_error_rate",
      severity: "warning",
      message: `Error rate ${((health.totalErrors / health.totalRuns) * 100).toFixed(1)}% over ${health.totalRuns} runs`,
      errorRate: (health.totalErrors / health.totalRuns),
    });
  }

  return alerts;
}