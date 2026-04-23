// Trade Executor v3 - HIGH-VOLUME LEARNING BOT
// Executes trades with adaptive stops, $500+ minimum per trade
// Supports both crypto and stock trading
// NOTE: Alpaca crypto does NOT support bracket/OTOCO orders
// For crypto: simple market BUY + separate SL/TP limit orders
// For stocks: bracket orders work fine

import { submitOrder, closePosition, getPositions, getOrders, cancelOrder } from "./alpaca-client.js";

/**
 * Execute a BUY for crypto with separate stop-loss and take-profit orders
 */
export async function executeBuy(symbol, qty, stopLossPrice, takeProfitPrice) {
  if (stopLossPrice <= 0 || takeProfitPrice <= 0) {
    return { success: false, message: `Invalid SL/TP for ${symbol}: SL=${stopLossPrice}, TP=${takeProfitPrice}` };
  }

  // Step 1: Place the market buy order
  const marketOrder = {
    symbol,
    qty: String(qty),
    side: "buy",
    type: "market",
    time_in_force: "gtc",
  };

  try {
    const buyResult = await submitOrder(marketOrder);
    
    // Step 2: Place stop-loss order
    try {
      await submitOrder({
        symbol,
        qty: String(qty),
        side: "sell",
        type: "stop_limit",
        stop_price: String(stopLossPrice),
        limit_price: String(stopLossPrice * 0.995),
        time_in_force: "gtc",
      });
    } catch (slErr) {
      console.log(`Stop-loss order failed for ${symbol}: ${slErr.message}`);
    }

    // Step 3: Place take-profit order
    try {
      await submitOrder({
        symbol,
        qty: String(qty),
        side: "sell",
        type: "limit",
        limit_price: String(takeProfitPrice),
        time_in_force: "gtc",
      });
    } catch (tpErr) {
      console.log(`Take-profit order failed for ${symbol}: ${tpErr.message}`);
    }

    return {
      success: true,
      order: marketOrder,
      result: buyResult,
      message: `BUY ${qty} ${symbol} | SL: $${stopLossPrice.toFixed(2)} | TP: $${takeProfitPrice.toFixed(2)}`,
    };
  } catch (err) {
    return {
      success: false,
      order: marketOrder,
      error: err.message,
      message: `BUY FAILED ${qty} ${symbol}: ${err.message}`,
    };
  }
}

/**
 * Execute a bracket buy order (for STOCKS only - crypto doesn't support this)
 */
export async function executeBuyBracket(symbol, qty, stopLossPrice, takeProfitPrice) {
  const order = {
    symbol,
    qty: String(qty),
    side: "buy",
    type: "market",
    time_in_force: "gtc",
    order_class: "bracket",
    stop_loss: {
      stop_price: String(stopLossPrice),
      limit_price: String(stopLossPrice * 0.995),
    },
    take_profit: {
      limit_price: String(takeProfitPrice),
    },
  };

  try {
    const result = await submitOrder(order);
    return {
      success: true,
      order,
      result,
      message: `BUY ${qty} ${symbol} (bracket) | SL: $${stopLossPrice.toFixed(2)} | TP: $${takeProfitPrice.toFixed(2)}`,
    };
  } catch (err) {
    return {
      success: false,
      order,
      error: err.message,
      message: `BUY BRACKET FAILED ${qty} ${symbol}: ${err.message}`,
    };
  }
}

/**
 * Execute a SELL (close position)
 */
export async function executeSell(symbol, qty, reason = "") {
  const order = {
    symbol,
    qty: String(qty),
    side: "sell",
    type: "market",
    time_in_force: "gtc",
  };

  try {
    const result = await submitOrder(order);
    return {
      success: true,
      order,
      result,
      message: `SELL ${qty} ${symbol}${reason ? ` (${reason})` : ""}`,
    };
  } catch (err) {
    return {
      success: false,
      order,
      error: err.message,
      message: `SELL FAILED ${qty} ${symbol}: ${err.message}`,
    };
  }
}

/**
 * Close a position by symbol (liquidate)
 */
export async function liquidatePosition(symbol) {
  try {
    const result = await closePosition(symbol);
    return {
      success: true,
      result,
      message: `LIQUIDATED ${symbol}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      message: `LIQUIDATE FAILED ${symbol}: ${err.message}`,
    };
  }
}

/**
 * Cancel all open orders
 */
export async function cancelAllOrders() {
  try {
    const orders = await getOrders("open");
    const results = [];
    for (const order of orders) {
      try {
        await cancelOrder(order.id);
        results.push({ id: order.id, canceled: true });
      } catch (e) {
        results.push({ id: order.id, error: e.message });
      }
    }
    return { success: true, results, message: `Cancelled ${results.length} orders` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Execute a signal from the strategy scanner
 * v3: $500+ trade sizes enforced, stock support, scalp-aware sizing
 */
export async function executeSignal(signal, riskManager, equity, positions) {
  // Check if already in this position
  const existingPos = positions?.find(p => p.symbol === signal.symbol);
  if (existingPos) {
    return { success: false, message: `Already in position: ${signal.symbol}` };
  }

  // Check if we can open more positions
  const positionCheck = riskManager.canOpenPosition(positions);
  if (!positionCheck.allowed) {
    return { success: false, message: positionCheck.reason };
  }

  if (!signal.currentPrice || signal.currentPrice <= 0) {
    return { success: false, message: `No current price for ${signal.symbol}` };
  }

  // Get ATR value for adaptive stop sizing
  const atrValue = signal.indicators?.atr || 0;

  const position = riskManager.calculatePositionSize(equity, signal.currentPrice, "long", atrValue);
  
  // ENFORCE $500 minimum trade size (upgrade from v2)
  let tradeQty = position.qty;
  const tradeValue = tradeQty * signal.currentPrice;
  const minTradeSize = riskManager.minTradeSizeUsd || 500;
  
  if (tradeValue < minTradeSize) {
    // Bump qty to meet minimum
    tradeQty = minTradeSize / signal.currentPrice;
  }

  // For scalp signals, use smaller position but still $500 minimum
  if (signal.strategy === "scalp") {
    const scalpTarget = Math.max(minTradeSize, equity * 0.01); // 1% of equity or $500, whichever is higher
    tradeQty = scalpTarget / signal.currentPrice;
  }

  // Round qty appropriately
  const isStockTicker = !signal.symbol.includes("/USD") && !signal.symbol.endsWith("USD") && signal.symbol === signal.symbol.toUpperCase() && !signal.symbol.includes("/");
  
  if (isStockTicker) {
    // Stocks: whole shares only
    tradeQty = Math.floor(tradeQty);
    if (tradeQty < 1) {
      // Use fractional if the stock supports it - try with qty 1
      tradeQty = minTradeSize / signal.currentPrice;
      // Round to 6 decimal for fractional
      tradeQty = Math.floor(tradeQty * 1000000) / 1000000;
    }
  } else {
    // Crypto: 6 decimal precision
    tradeQty = Math.floor(tradeQty * 1000000) / 1000000;
  }

  if (tradeQty <= 0) {
    return { success: false, message: `Calculated qty is 0 for ${signal.symbol} at $${signal.currentPrice}` };
  }

  // Calculate stops
  let stopLoss, takeProfit;
  
  if (atrValue > 0) {
    const atrMult = signal.strategy === "scalp" ? 1.0 : 1.5; // Tighter stops for scalps
    stopLoss = signal.currentPrice - atrValue * atrMult;
    takeProfit = signal.currentPrice + atrValue * (atrMult * 2); // 2:1 R:R
  } else {
    // Default percentage stops
    let slPct = 0.03; // 3%
    let tpPct = 0.06; // 6%
    
    if (signal.strategy === "scalp") {
      slPct = 0.015; // 1.5% (tighter for scalps)
      tpPct = 0.03;  // 3%
    } else if (signal.strategy === "mean-reversion") {
      slPct = 0.04;  // 4% (wider for MR)
      tpPct = 0.04;  // 4% (1:1 for MR)
    }
    
    stopLoss = signal.currentPrice * (1 - slPct);
    takeProfit = signal.currentPrice * (1 + tpPct);
  }

  // Ensure stop-loss is positive
  if (stopLoss <= 0) {
    stopLoss = signal.currentPrice * 0.97;
  }

  // Detect if this is crypto or stock
  const isCrypto = signal.symbol.includes("/USD") || signal.symbol.endsWith("USD");

  if (signal.signal === "buy") {
    if (isCrypto) {
      return await executeBuy(signal.symbol, tradeQty, stopLoss, takeProfit);
    } else {
      return await executeBuyBracket(signal.symbol, tradeQty, stopLoss, takeProfit);
    }
  } else if (signal.signal === "sell") {
    // Long-only policy: sell signals become no-ops
    return { success: false, message: `Sell signal for ${signal.symbol} - skipping (long only policy)` };
  }

  return { success: false, message: `Unknown signal type: ${signal.signal}` };
}

/**
 * Execute a stock signal from the stock scanner
 * Stocks use bracket orders and different quantity rules
 */
export async function executeStockSignal(signal, riskManager, equity, positions) {
  signal.currentPrice = signal.price || signal.currentPrice;
  if (!signal.currentPrice || signal.currentPrice <= 0) {
    return { success: false, message: `No price for stock ${signal.symbol}` };
  }

  // Use 1% of equity per stock trade, $500 minimum
  let positionValue = Math.max(equity * 0.01, riskManager.minTradeSizeUsd || 500);
  let qty = Math.floor(positionValue / signal.currentPrice);
  
  if (qty <= 0) {
    qty = 1; // At least 1 share for stocks
  }

  const stopLoss = signal.currentPrice * 0.97;
  const takeProfit = signal.currentPrice * 1.06;

  return await executeBuyBracket(signal.symbol, qty, stopLoss, takeProfit);
}

/**
 * Force-close losing positions
 * v3: also close positions that have been open a long time for rotation
 */
export async function closeWorstPositions(positions, maxLossPct = 0.02) {
  const closed = [];
  for (const pos of (positions || [])) {
    const entry = parseFloat(pos.avg_entry_price);
    const current = parseFloat(pos.current_price);
    const pnlPct = (current - entry) / entry;
    if (pnlPct <= -maxLossPct) {
      const result = await liquidatePosition(pos.symbol);
      closed.push({ symbol: pos.symbol, pnl: pnlPct, result });
    }
  }
  return closed;
}

/**
 * Rotate positions - close small/hesitant positions to free up slots for new signals
 * This helps achieve higher trade volume by not letting dead weight sit
 */
export async function rotateStalePositions(positions, minPnlPct = 0.005, maxAgeHours = 4) {
  const closed = [];
  for (const pos of (positions || [])) {
    const entry = parseFloat(pos.avg_entry_price);
    const current = parseFloat(pos.current_price);
    const pnlPct = (current - entry) / entry;
    const marketValue = parseFloat(pos.market_value || 0);
    
    // Close tiny positions that aren't moving (cleanup for rotation)
    if (marketValue < 400 && Math.abs(pnlPct) < 0.01) {
      const result = await liquidatePosition(pos.symbol);
      closed.push({ symbol: pos.symbol, pnl: pnlPct, reason: "Too small, rotating", result });
    }
  }
  return closed;
}