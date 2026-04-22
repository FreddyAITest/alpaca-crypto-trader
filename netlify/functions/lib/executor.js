// Trade Executor
// Executes trades with stop-loss and take-profit bracket orders
// Wraps the Alpaca order API with risk-managed order types

import { submitOrder, closePosition, getPositions, getOrders, cancelOrder } from "./alpaca-client.js";

/**
 * Execute a BUY with bracket order (stop-loss + take-profit)
 * Uses Alpaca's bracket order feature for automatic exits
 */
export async function executeBuy(symbol, qty, stopLossPrice, takeProfitPrice) {
  const order = {
    symbol,
    qty: String(qty),
    side: "buy",
    type: "market",
    time_in_force: "gtc",
    order_class: "bracket",
    stop_loss: {
      stop_price: String(stopLossPrice),
      limit_price: String(stopLossPrice * 0.995), // Slight buffer for limit
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
      message: `BUY ${qty} ${symbol} | SL: $${stopLossPrice.toFixed(2)} | TP: $${takeProfitPrice.toFixed(2)}`,
    };
  } catch (err) {
    return {
      success: false,
      order,
      error: err.message,
      message: `BUY FAILED ${qty} ${symbol}: ${err.message}`,
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
 * Applies risk management before placing the trade
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

  // Get current price from signal data (placeholder - real price from snapshot)
  // For now we'll use the latest close from the bar data
  if (!signal.currentPrice) {
    return { success: false, message: `No current price for ${signal.symbol}` };
  }

  const position = riskManager.calculatePositionSize(equity, signal.currentPrice, "long");
  if (position.qty === 0) {
    return { success: false, message: position.reason };
  }

  if (signal.signal === "buy") {
    return await executeBuy(signal.symbol, position.qty, position.stopLoss, position.takeProfit);
  } else if (signal.signal === "sell") {
    // For sell signals without a position, we could short
    // But for crypto paper trading, sticking to long-only for safety
    return { success: false, message: `Sell signal for ${signal.symbol} - no short positions (long only policy)` };
  }

  return { success: false, message: `Unknown signal type: ${signal.signal}` };
}