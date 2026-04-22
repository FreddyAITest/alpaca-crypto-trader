// Risk Management Engine
// Enforces position sizing, daily loss limits, max drawdown, concentration limits

export class RiskManager {
  constructor(config = {}) {
    // Default risk parameters
    this.maxPositionPct = config.maxPositionPct || 0.10;       // Max 10% of equity per position
    this.dailyLossLimitPct = config.dailyLossLimitPct || 0.03;  // Stop trading if down 3% today
    this.maxDrawdownPct = config.maxDrawdownPct || 0.05;        // Stop all trading if drawdown > 5%
    this.maxOpenPositions = config.maxOpenPositions || 5;       // Max 5 concurrent positions
    this.minTradeSizeUsd = config.minTradeSizeUsd || 10;        // Min $10 per trade
    this.defaultStopLossPct = config.defaultStopLossPct || 0.02; // 2% stop-loss
    this.defaultTakeProfitPct = config.defaultTakeProfitPct || 0.04; // 4% take-profit (2:1 R:R)
    this.dailyProfitTargetPct = config.dailyProfitTargetPct || 0.08; // 8% daily profit target (upper)
  }

  /**
   * Check if trading is allowed based on current account state
   * Returns { allowed: bool, reason: string }
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
   * Returns { qty: number, stopLoss: number, takeProfit: number, reason: string }
   */
  calculatePositionSize(equity, entryPrice, side = "long") {
    // Position size: max % of equity
    const maxPositionValue = equity * this.maxPositionPct;
    let qty = maxPositionValue / entryPrice;

    // Apply minimum trade size
    if (maxPositionValue < this.minTradeSizeUsd) {
      return { qty: 0, stopLoss: 0, takeProfit: 0, reason: `Position too small: $${maxPositionValue.toFixed(2)} < min $${this.minTradeSizeUsd}` };
    }

    // Calculate stop-loss and take-profit
    const stopLossPct = this.defaultStopLossPct;
    const takeProfitPct = this.defaultTakeProfitPct;
    
    let stopLoss, takeProfit;
    if (side === "long") {
      stopLoss = entryPrice * (1 - stopLossPct);
      takeProfit = entryPrice * (1 + takeProfitPct);
    } else {
      stopLoss = entryPrice * (1 + stopLossPct);
      takeProfit = entryPrice * (1 - takeProfitPct);
    }

    return {
      qty: Math.floor(qty * 1000000) / 1000000, // Round to 6 decimals for crypto
      stopLoss,
      takeProfit,
      reason: `Position: $${maxPositionValue.toFixed(2)} (${(this.maxPositionPct * 100).toFixed(0)}% of $${equity.toFixed(2)}). SL: ${stopLoss.toFixed(2)}, TP: ${takeProfit.toFixed(2)}`
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
   * Returns array of positions that should be closed
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
          toClose.push({ symbol: pos.symbol, reason: `Stop-loss hit: ${(pnlPct * 100).toFixed(2)}% (SL: -${(this.defaultStopLossPct * 100).toFixed(0)}%)` });
        } else if (pnlPct >= this.defaultTakeProfitPct) {
          toClose.push({ symbol: pos.symbol, reason: `Take-profit hit: ${(pnlPct * 100).toFixed(2)}% (TP: +${(this.defaultTakeProfitPct * 100).toFixed(0)}%)` });
        }
      } else {
        // Short positions
        const pnlPct = (entry - current) / entry;
        if (pnlPct <= -this.defaultStopLossPct) {
          toClose.push({ symbol: pos.symbol, reason: `Stop-loss hit: ${(pnlPct * 100).toFixed(2)}% (SL: -${(this.defaultStopLossPct * 100).toFixed(0)}%)` });
        } else if (pnlPct >= this.defaultTakeProfitPct) {
          toClose.push({ symbol: pos.symbol, reason: `Take-profit hit: ${(pnlPct * 100).toFixed(2)}% (TP: +${(this.defaultTakeProfitPct * 100).toFixed(0)}%)` });
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
    
    return {
      equity,
      dailyPnlPct: dailyPnlPct,
      dailyPnlPctStr: `${(dailyPnlPct * 100).toFixed(2)}%`,
      positionCount: positions?.length || 0,
      maxPositions: this.maxOpenPositions,
      lossLimitPct: this.dailyLossLimitPct,
      profitTargetPct: this.dailyProfitTargetPct,
      stopLossPct: this.defaultStopLossPct,
      takeProfitPct: this.defaultTakeProfitPct,
      status: dailyPnlPct <= -this.dailyLossLimitPct ? "STOPPED_LOSS" 
            : dailyPnlPct >= this.dailyProfitTargetPct ? "STOPPED_PROFIT" 
            : "TRADING",
    };
  }
}