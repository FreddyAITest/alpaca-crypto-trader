// Bot Status API - Returns current bot state, risk metrics, and cron health
// Called by the dashboard to display bot status

import { getAccount, getPositions, getPortfolioHistory } from './lib/alpaca-client.mjs';
import { RiskManager } from './lib/risk-manager.mjs';
import { getHealth, getAlerts } from './lib/health-store.mjs';

export default async (req) => {
  try {
    const account = await getAccount();
    const positions = await getPositions();
    const history = await getPortfolioHistory("1M", "1D");

    const riskManager = new RiskManager();
    const tradingAllowed = await riskManager.checkTradingAllowed(account, positions, history);
    const riskSummary = riskManager.getRiskSummary(account, positions);
    const slTpStatus = riskManager.checkStopLossTakeProfit(positions);

    // Fetch cron health from persistent store
    let cronHealth = null;
    let cronAlerts = [];
    try {
      const health = await getHealth();
      cronAlerts = await getAlerts(health);

      const minutesSinceRun = health.lastRun
        ? Math.round((Date.now() - new Date(health.lastRun).getTime()) / 60000)
        : null;

      cronHealth = {
        lastRun: health.lastRun,
        lastSuccess: health.lastSuccess,
        minutesSinceLastRun: minutesSinceRun,
        consecutiveErrors: health.consecutiveErrors,
        totalRuns: health.totalRuns,
        totalErrors: health.totalErrors,
        errorRate: health.totalRuns > 0
          ? ((health.totalErrors / health.totalRuns) * 100).toFixed(1)
          : "0.0",
        isHealthy: cronAlerts.filter(a => a.severity === "critical").length === 0,
        recentRuns: health.recentRuns.slice(-10),
        schedule: "every 5 minutes",
      };
    } catch (e) {
      cronHealth = {
        error: `Could not fetch health: ${e.message}`,
        isHealthy: false,
      };
    }

    const response = {
      status: "active",
      timestamp: new Date().toISOString(),
      account: {
        equity: parseFloat(account.equity),
        cash: parseFloat(account.cash),
        buyingPower: parseFloat(account.buying_power),
        status: account.status,
      },
      risk: riskSummary,
      tradingAllowed: tradingAllowed.allowed,
      tradingReason: tradingAllowed.reason,
      positions: positions.map(p => ({
        symbol: p.symbol,
        side: p.side,
        qty: parseFloat(p.qty),
        entryPrice: parseFloat(p.avg_entry_price),
        currentPrice: parseFloat(p.current_price),
        marketValue: parseFloat(p.market_value),
        unrealizedPnl: parseFloat(p.unrealized_pl),
        unrealizedPnlPct: parseFloat(p.unrealized_plpc) * 100,
      })),
      alerts: slTpStatus.map(s => ({
        symbol: s.symbol,
        type: s.reason.includes("Stop-loss") ? "stop_loss" : "take_profit",
        message: s.reason,
      })),
      // Cron health monitoring data
      cron: cronHealth,
      cronAlerts: cronAlerts,
    };

    return new Response(JSON.stringify(response, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ status: "error", error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

// No path config - routed via netlify.toml redirect