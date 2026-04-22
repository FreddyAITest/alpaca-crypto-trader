// Bot Status API - Returns current bot state and risk metrics
// Called by the dashboard to display bot status

import { getAccount, getPositions, getPortfolioHistory } from "./lib/alpaca-client.js";
import { RiskManager } from "./lib/risk-manager.js";

export default async (req) => {
  try {
    const account = await getAccount();
    const positions = await getPositions();
    const history = await getPortfolioHistory("1M", "1D");

    const riskManager = new RiskManager();
    const tradingAllowed = await riskManager.checkTradingAllowed(account, positions, history);
    const riskSummary = riskManager.getRiskSummary(account, positions);
    const slTpStatus = riskManager.checkStopLossTakeProfit(positions);

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

export const config = { path: "/api/trading-bot/status" };