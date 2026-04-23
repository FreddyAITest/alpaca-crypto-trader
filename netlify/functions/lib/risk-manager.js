// Risk Management Engine v4 - HIGH-VOLUME LEARNING BOT
// More aggressive for learning velocity: higher position sizes, active SL/TP replacement
// Crypto + stocks (paper), targets hundreds of trades/day for fast learning
// SL/TP orders are re-placed every cycle to ensure they exist

export class RiskManager {
  constructor(config = {}) {
    // More aggressive risk parameters for v4 learning bot
    this.maxPositionPct = config.maxPositionPct || 0.05;          // 5% of equity per position (up from 3%)
    this.dailyLossLimitPct = config.dailyLossLimitPct || 0.03;     // Stop trading if down 3% today
    this.maxDrawdownPct = config.maxDrawdownPct || 0.05;           // Stop all trading if drawdown > 5%
    this.maxOpenPositions = config.maxOpenPositions || 25;         // 25 concurrent positions
    this.minTradeSizeUsd = config.minTradeSizeUsd || 500;          // $500 minimum per trade
    this.defaultStopLossPct = config.defaultStopLossPct || 0.03;   // 3% stop-loss
    this.defaultTakeProfitPct = config.defaultTakeProfitPct || 0.06; // 6% take-profit (2:1 R:R)
    this.dailyProfitTargetPct = config.dailyProfitTargetPct || 0.08; // 8% daily profit target (upper)

    // Adaptive stops based on ATR
    this.useAtrStops = config.useAtrStops !== false; // Default true
    this.atrStopMultiplier = config.atrStopMultiplier || 1.5;
    this.atrProfitMultiplier = config.atrProfitMultiplier || 3;

    // Trailing stop
    this.trailingStopPct = config.trailingStopPct || 0.01; // 1% trailing
  }

  /**
   * Check if trading is allowed based on current account state
   */
  async checkTradingAllowed(account, positions, portfolioHistory) {
    const equity = parseFloat(account.equity);
    const lastEquity = parseFloat(account.last_mkt_value || equity);

    // Check if account is blocked
    if (account.status !== "ACTIVE") {
      return { allowed: false, reason: `Account status: ${account.status}` };
    }

    // Daily loss check
    const dailyPnlPct = (equity - lastEquity) / lastEquity;
    if (dailyPnlPct <= -this.dailyLossLimitPct) {
      return { allowed: false, reason: `Daily loss limit reached: ${(dailyPnlPct * 100).toFixed(2)}% (limit: -${(this.dailyLossLimitPct * 100).toFixed(0)}%)` };
    }

    // Daily profit target check - stop trading if we hit upper target
    if (dailyPnlPct >= this.dailyProfitTargetPct) {
      return { allowed: false, reason: `Daily profit target reached: ${(dailyPnlPct * 100).toFixed(2)}% (target: ${(this.dailyProfitTargetPct * 100).toFixed(0)}%). Secured!` };
    }

    // Max drawdown check from portfolio history
    if (portfolioHistory && portfolioHistory.equity && portfolioHistory.equity.length > 0) {
      const peak = Math.max(...portfolioHistory.equity.map(Number));
      const currentDrawdown = (equity - peak) / peak;
      if (currentDrawdown <= -this.maxDrawdownPct) {
        return { allowed: false, reason: `Max drawdown breached: ${(currentDrawdown * 100).toFixed(2)}% (limit: -${(this.maxDrawdownPct * 100).toFixed(0)}%). Liquidate!` };
      }
    }

    return { allowed: true, reason: "Trading allowed" };
  }

  /**
   * Calculate position size based on risk rules
   * v4: Higher position sizes for more capital deployment
   */
  calculatePositionSize(equity, entryPrice, side = "long", atrValue = 0) {
    // Position size: % of equity
    let positionValue = equity * this.maxPositionPct;

    // Ensure minimum $500 trade size
    if (positionValue < this.minTradeSizeUsd) {
      positionValue = this.minTradeSizeUsd;
    }

    // Hard cap: 10% of equity per position (safety)
    const maxSafeValue = equity * 0.10;
    if (positionValue > maxSafeValue) {
      positionValue = maxSafeValue;
    }

    let qty = positionValue / entryPrice;
    positionValue = qty * entryPrice; // recalculate actual

    // Recalculate to enforce $500 minimum
    if (positionValue < this.minTradeSizeUsd) {
      qty = this.minTradeSizeUsd / entryPrice;
      positionValue = this.minTradeSizeUsd;
    }

    // Calculate stop-loss and take-profit
    let stopLoss, takeProfit;

    if (this.useAtrStops && atrValue > 0) {
      // ATR-based stops (adaptive to volatility)
      if (side === "long") {
        stopLoss = entryPrice - atrValue * this.atrStopMultiplier;
        takeProfit = entryPrice + atrValue * this.atrProfitMultiplier;
      } else {
        stopLoss = entryPrice + atrValue * this.atrStopMultiplier;
        takeProfit = entryPrice - atrValue * this.atrProfitMultiplier;
      }
    } else {
      // Fallback to percentage-based stops
      if (side === "long") {
        stopLoss = entryPrice * (1 - this.defaultStopLossPct);
        takeProfit = entryPrice * (1 + this.defaultTakeProfitPct);
      } else {
        stopLoss = entryPrice * (1 + this.defaultStopLossPct);
        takeProfit = entryPrice * (1 - this.defaultTakeProfitPct);
      }
    }

    return {
      qty: Math.floor(qty * 1000000) / 1000000, // Round to 6 decimals for crypto
      stopLoss,
      takeProfit,
      positionValue,
      reason: `Position: $${positionValue.toFixed(2)} (${(this.maxPositionPct * 100).toFixed(1)}% of $${equity.toFixed(2)}). SL: $${stopLoss.toFixed(2)}, TP: $${takeProfit.toFixed(2)}${atrValue > 0 ? ' (ATR-based)' : ''}`
    };
  }

  /**
   * Check if we can open a new position
   */
  canOpenPosition(currentPositions) {
    const openCount = Array.isArray(currentPositions) ? currentPositions.length : 0;
    if (openCount >= this.maxOpenPositions) {
      return { allowed: false, reason: `Max positions reached: ${openCount}/${this.maxOpenPositions}` };
    }
    return { allowed: true, reason: `Positions: ${openCount}/${this.maxOpenPositions}` };
  }

  /**
   * Check if any open position has hit stop-loss or take-profit
   * v4: More aggressive — includes positions that are slightly profitable
   */
  checkStopLossTakeProfit(positions) {
    const toClose = [];

    for (const pos of positions) {
      const entry = parseFloat(pos.avg_entry_price);
      const current = parseFloat(pos.current_price);
      const side = pos.side;

      if (side === "long") {
        const pnlPct = (current - entry) / entry;
        if (pnlPct <= -this.defaultStopLossPct) {
          toClose.push({ symbol: pos.symbol, reason: `Stop-loss hit: ${(pnlPct * 100).toFixed(2)}% (SL: -${(this.defaultStopLossPct * 100).toFixed(1)}%)` });
        } else if (pnlPct >= this.defaultTakeProfitPct) {
          toClose.push({ symbol: pos.symbol, reason: `Take-profit hit: ${(pnlPct * 100).toFixed(2)}% (TP: +${(this.defaultTakeProfitPct * 100).toFixed(1)}%)` });
        }
      } else {
        // Short positions
        const pnlPct = (entry - current) / entry;
        if (pnlPct <= -this.defaultStopLossPct) {
          toClose.push({ symbol: pos.symbol, reason: `Stop-loss hit: ${(pnlPct * 100).toFixed(2)}% (SL: -${(this.defaultStopLossPct * 100).toFixed(1)}%)` });
        } else if (pnlPct >= this.defaultTakeProfitPct) {
          toClose.push({ symbol: pos.symbol, reason: `Take-profit hit: ${(pnlPct * 100).toFixed(2)}% (TP: +${(this.defaultTakeProfitPct * 100).toFixed(1)}%)` });
        }
      }
    }

    return toClose;
  }

  /**
   * Get risk summary for dashboard
   */
  getRiskSummary(account, positions) {
    const equity = parseFloat(account.equity);
    const lastEquity = parseFloat(account.last_mkt_value || equity);
    const dailyPnlPct = (equity - lastEquity) / lastEquity;
    const positionsArr = Array.isArray(positions) ? positions : [];
    const totalExposure = positionsArr.reduce((sum, p) => sum + parseFloat(p.market_value || 0), 0);

    return {
      equity,
      dailyPnlPct: dailyPnlPct,
      dailyPnlPctStr: `${(dailyPnlPct * 100).toFixed(2)}%`,
      positionCount: positionsArr.length,
      maxPositions: this.maxOpenPositions,
      totalExposure: totalExposure.toFixed(2),
      exposurePct: equity > 0 ? ((totalExposure / equity) * 100).toFixed(1) + "%" : "0%",
      lossLimitPct: this.dailyLossLimitPct,
      profitTargetPct: this.dailyProfitTargetPct,
      stopLossPct: this.defaultStopLossPct,
      takeProfitPct: this.defaultTakeProfitPct,
      minTradeSize: this.minTradeSizeUsd,
      status: dailyPnlPct <= -this.dailyLossLimitPct ? "STOPPED_LOSS"
            : dailyPnlPct >= this.dailyProfitTargetPct ? "STOPPED_PROFIT"
            : "TRADING",
    };
  }
}