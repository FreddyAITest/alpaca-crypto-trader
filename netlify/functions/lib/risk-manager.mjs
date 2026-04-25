// Risk Management Engine v6 - POSITION LIMITS
// v6: Max position value $7k, max buy $5k, always check existing position before trading
// Crypto + stocks (paper), targets 2-8% daily returns with controlled position sizes
export class RiskManager {
  constructor(config = {}) {
    // v6: Controlled position sizing — max $5k buy, max $7k total per position
    this.maxPositionPct = config.maxPositionPct || 0.10;          // 10% of equity per position (fallback)
    this.maxBuyValueUsd = config.maxBuyValueUsd || 5000;         // Max $5k per new buy order
    this.maxPositionValueUsd = config.maxPositionValueUsd || 7000; // Max $7k total position value
    this.dailyLossLimitPct = config.dailyLossLimitPct || 0.05;     // 5% daily loss limit
    this.maxDrawdownPct = config.maxDrawdownPct || 0.08;           // 8% max drawdown
    this.maxOpenPositions = config.maxOpenPositions || 25;         // 25 concurrent positions
    this.minTradeSizeUsd = config.minTradeSizeUsd || 500;          // $500 minimum per trade
    this.defaultStopLossPct = config.defaultStopLossPct || 0.05;   // 5% stop-loss
    this.defaultTakeProfitPct = config.defaultTakeProfitPct || 0.08; // 8% take-profit
    this.dailyProfitTargetPct = config.dailyProfitTargetPct || 0.10; // 10% daily profit target

    // Adaptive stops based on ATR
    this.useAtrStops = config.useAtrStops !== false; // Default true
    this.atrStopMultiplier = config.atrStopMultiplier || 2.0;   // wider ATR stops
    this.atrProfitMultiplier = config.atrProfitMultiplier || 4; // wider ATR targets

    // Trailing stop
    this.trailingStopPct = config.trailingStopPct || 0.015; // 1.5% trailing
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
   * v6: Check if we can buy a symbol — enforces max position value ($7k) and max buy ($5k)
   * - If we already hold this symbol, check that the current value + buy amount doesn't exceed maxPositionValueUsd
   * - The buy amount itself must not exceed maxBuyValueUsd
   * - Returns { allowed, buyAmount, existingValue, reason }
   */
  checkPositionBuyAllowed(symbol, proposedBuyValue, currentPositions) {
    const positions = Array.isArray(currentPositions) ? currentPositions : [];
    
    // Find existing position for this symbol
    // Match both "BTC/USD" and "BTCUSD" style symbols
    const existingPos = positions.find(p => {
      const posSym = p.symbol || '';
      return posSym === symbol || 
             posSym === symbol.replace('/', '') || 
             posSym.replace('/', '') === symbol.replace('/', '') ||
             (symbol.includes('/') && posSym === symbol.split('/')[0] + 'USD') ||
             (posSym.includes('/') && symbol === posSym.split('/')[0] + 'USD');
    });

    const existingValue = existingPos ? parseFloat(existingPos.market_value || 0) : 0;
    
    // Check if existing position already exceeds max value — no more buying allowed
    if (existingPos && existingValue >= this.maxPositionValueUsd) {
      return {
        allowed: false,
        buyAmount: 0,
        existingValue,
        reason: `Already holding $${existingValue.toFixed(2)} of ${symbol} — at or above max position value $${this.maxPositionValueUsd}`,
      };
    }

    // Cap the buy amount at maxBuyValueUsd
    let buyAmount = Math.min(proposedBuyValue, this.maxBuyValueUsd);

    // If we already hold this symbol, cap total (existing + buy) at maxPositionValueUsd
    if (existingPos && existingValue > 0) {
      const roomToBuy = this.maxPositionValueUsd - existingValue;
      if (roomToBuy <= 0) {
        return {
          allowed: false,
          buyAmount: 0,
          existingValue,
          reason: `Already holding $${existingValue.toFixed(2)} of ${symbol} — no room to add ($${this.maxPositionValueUsd} max)`,
        };
      }
      buyAmount = Math.min(buyAmount, roomToBuy);
    }

    // Don't allow tiny buys (< minTradeSizeUsd)
    if (buyAmount < this.minTradeSizeUsd) {
      return {
        allowed: false,
        buyAmount: 0,
        existingValue,
        reason: `Buy amount $${buyAmount.toFixed(2)} below minimum $${this.minTradeSizeUsd} for ${symbol}`,
      };
    }

    return {
      allowed: true,
      buyAmount,
      existingValue,
      reason: existingPos 
        ? `Adding $${buyAmount.toFixed(2)} to existing $${existingValue.toFixed(2)} position in ${symbol} (max $${this.maxPositionValueUsd})`
        : `New position $${buyAmount.toFixed(2)} in ${symbol} (max $${this.maxBuyValueUsd} buy)`,
    };
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
      // Determine strategy from position metadata if available; default to momentum
      const strategy = pos.strategy || "momentum";
      let slPct, tpPct;
      switch (strategy) {
        case "scalp": slPct = this.scalpStopLossPct; tpPct = this.scalpTakeProfitPct; break;
        case "mean-reversion": slPct = this.meanRevStopLossPct; tpPct = this.meanRevTakeProfitPct; break;
        default: slPct = this.defaultStopLossPct; tpPct = this.defaultTakeProfitPct; break;
      }

      if (side === "long") {
        const pnlPct = (current - entry) / entry;
        if (pnlPct <= -slPct) {
          toClose.push({ symbol: pos.symbol, reason: `Stop-loss hit: ${(pnlPct * 100).toFixed(2)}% (SL: -${(slPct * 100).toFixed(1)}%)` });
        } else if (pnlPct >= tpPct) {
          toClose.push({ symbol: pos.symbol, reason: `Take-profit hit: ${(pnlPct * 100).toFixed(2)}% (TP: +${(tpPct * 100).toFixed(1)}%)` });
        } else if (this.useTrailingStop && pnlPct >= 0.03) {
          // Trailing stop: once up 3%, maintain 1.5% below highest watermark
          const maxPnL = (parseFloat(pos.high_watermark || current) - entry) / entry;
          if (pnlPct <= maxPnL - this.trailingStopPct) {
            toClose.push({ symbol: pos.symbol, reason: `Trailing stop: ${(pnlPct * 100).toFixed(2)}% (max +${(maxPnL * 100).toFixed(1)}%)` });
          }
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
      maxBuyValueUsd: this.maxBuyValueUsd,
      maxPositionValueUsd: this.maxPositionValueUsd,
      status: dailyPnlPct <= -this.dailyLossLimitPct ? "STOPPED_LOSS"
            : dailyPnlPct >= this.dailyProfitTargetPct ? "STOPPED_PROFIT"
            : "TRADING",
    };
  }
}