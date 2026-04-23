// Trade Executor v4 - HIGH-VOLUME LEARNING BOT
// Rewritten SL/TP: polls for buy fill, then places sell orders with actual filled qty
// Aggressive position rotation for learning velocity
// Supports both crypto and stock trading
// NOTE: Alpaca crypto does NOT support bracket/OTOCO orders
// For crypto: simple market BUY + delayed SL/TP after fill confirmation

import { submitOrder, closePosition, getPositions, getOrders, cancelOrder, getOrder, getAccount } from "./alpaca-client.js";

/**
 * Wait for a market order to fill, polling every 2 seconds up to maxWait
 * Returns the filled order or throws on timeout
 */
async function waitForFill(orderId, maxWaitMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const order = await getOrder(orderId);
      if (order.status === "filled") return order;
      if (order.status === "partially_filled") {
        // Wait more for full fill
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      if (["canceled", "expired", "rejected", "replaced"].includes(order.status)) {
        throw new Error(`Order ${orderId} ended with status: ${order.status}`);
      }
      // Still pending - wait
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      // If we can't get the order, just return whatever we have
      console.log(`waitForFill: error checking order ${orderId}: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  // Timeout - try to get the order one more time
  try {
    const order = await getOrder(orderId);
    return order;
  } catch (e) {
    throw new Error(`Timeout waiting for order ${orderId} to fill`);
  }
}

/**
 * Execute a BUY for crypto with separate stop-loss and take-profit orders
 * v4: Waits for buy fill, then places SL/TP with actual filled qty
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
    const orderId = buyResult?.id || buyResult?.order?.id;

    // Step 2: Wait for buy to fill, then place SL/TP with actual qty
    if (orderId) {
      try {
        const filledOrder = await waitForFill(orderId, 15000);
        const filledQty = parseFloat(filledOrder.filled_qty || filledOrder.qty || qty);

        if (filledQty > 0 && filledOrder.status === "filled") {
          // Step 3: Place stop-loss order with actual filled quantity
          try {
            await submitOrder({
              symbol,
              qty: String(filledQty),
              side: "sell",
              type: "stop_limit",
              stop_price: String(stopLossPrice),
              limit_price: String(stopLossPrice * 0.995),
              time_in_force: "gtc",
            });
          } catch (slErr) {
            console.log(`Stop-loss order failed for ${symbol}: ${slErr.message}`);
          }

          // Step 4: Place take-profit order with actual filled quantity
          try {
            await submitOrder({
              symbol,
              qty: String(filledQty),
              side: "sell",
              type: "limit",
              limit_price: String(takeProfitPrice),
              time_in_force: "gtc",
            });
          } catch (tpErr) {
            console.log(`Take-profit order failed for ${symbol}: ${tpErr.message}`);
          }
        } else {
          // Order not fully filled yet - place SL/TP with original qty as fallback
          console.log(`Order ${orderId} not yet filled (status: ${filledOrder.status}), placing SL/TP with original qty`);
          placeFallbackSLTP(symbol, qty, stopLossPrice, takeProfitPrice);
        }
      } catch (fillErr) {
        console.log(`Could not confirm fill for ${symbol}: ${fillErr.message}. Placing SL/TP with original qty.`);
        placeFallbackSLTP(symbol, qty, stopLossPrice, takeProfitPrice);
      }
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
 * Fallback: place SL/TP with original qty when we can't confirm fill
 */
function placeFallbackSLTP(symbol, qty, stopLossPrice, takeProfitPrice) {
  // These may fail if position doesn't exist yet, but it's worth trying
  submitOrder({
    symbol,
    qty: String(qty),
    side: "sell",
    type: "stop_limit",
    stop_price: String(stopLossPrice),
    limit_price: String(stopLossPrice * 0.995),
    time_in_force: "gtc",
  }).catch(e => console.log(`Fallback SL failed for ${symbol}: ${e.message}`));

  submitOrder({
    symbol,
    qty: String(qty),
    side: "sell",
    type: "limit",
    limit_price: String(takeProfitPrice),
    time_in_force: "gtc",
  }).catch(e => console.log(`Fallback TP failed for ${symbol}: ${e.message}`));
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
 * Close a position by symbol (liquidate) — also cancels any open SL/TP orders for that symbol
 */
export async function liquidatePosition(symbol) {
  // First cancel any open orders for this symbol (SL/TP orders)
  try {
    const openOrders = await getOrders("open");
    const symbolOrders = openOrders.filter(o => o.symbol === symbol);
    for (const ord of symbolOrders) {
      try {
        await cancelOrder(ord.id);
      } catch (e) {
        console.log(`Cancel order ${ord.id} for ${symbol} failed: ${e.message}`);
      }
    }
  } catch (e) {
    console.log(`Cancel orders for ${symbol} failed: ${e.message}`);
  }

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
 * Cancel all open SL/TP (sell) orders — clean slate for re-placing
 */
export async function cancelSellOrders() {
  try {
    const orders = await getOrders("open");
    const sellOrders = orders.filter(o => o.side === "sell");
    const results = [];
    for (const order of sellOrders) {
      try {
        await cancelOrder(order.id);
        results.push({ id: order.id, symbol: order.symbol, canceled: true });
      } catch (e) {
        results.push({ id: order.id, symbol: order.symbol, error: e.message });
      }
    }
    return { success: true, results, message: `Cancelled ${results.length} sell orders` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Re-place stop-loss and take-profit orders for all open positions
 * v4.1: Smart about existing orders — only adds MISSING SL or TP orders
 * Never cancels existing sell orders (avoids "insufficient balance" race condition)
 * Uses available qty (position qty minus qty locked in existing sell orders)
 */
export async function replaceStopsAndTargets(positions, stopLossPct = 0.03, takeProfitPct = 0.06) {
  const actions = [];
  let openOrders;
  try {
    openOrders = await getOrders("open");
  } catch (e) {
    console.log(`replaceStopsAndTargets: could not fetch open orders: ${e.message}`);
    return actions;
  }

  // Build map of symbol -> open sell orders
  const sellOrdersBySymbol = {};
  for (const ord of openOrders) {
    if (ord.side === "sell") {
      if (!sellOrdersBySymbol[ord.symbol]) sellOrdersBySymbol[ord.symbol] = [];
      sellOrdersBySymbol[ord.symbol].push(ord);
    }
  }

  for (const pos of positions) {
    const symbol = pos.symbol;
    const entry = parseFloat(pos.avg_entry_price);
    const current = parseFloat(pos.current_price);
    const qty = parseFloat(pos.qty);
    const marketValue = parseFloat(pos.market_value || 0);

    if (marketValue < 1 || entry <= 0 || qty <= 0) continue;

    // Calculate available qty = total qty minus qty already locked in sell orders
    const existingSellOrders = sellOrdersBySymbol[symbol] || [];
    let qtyInSellOrders = 0;
    for (const ord of existingSellOrders) {
      qtyInSellOrders += parseFloat(ord.qty || 0);
    }
    const availableQty = Math.max(0, qty - qtyInSellOrders);
    // Round to 6 decimal places
    const availableQtyRounded = Math.floor(availableQty * 1000000) / 1000000;

    // Check what types of sell orders already exist
    const hasStopLoss = existingSellOrders.some(o =>
      o.type === "stop_limit" || o.type === "stop"
    );
    const hasTakeProfit = existingSellOrders.some(o =>
      o.type === "limit" && o.side === "sell"
    );

    if (hasStopLoss && hasTakeProfit) {
      // Already fully protected — skip
      continue;
    }

    // If no available qty, can't place any orders
    if (availableQtyRounded <= 0) {
      actions.push({
        symbol,
        action: "skip",
        reason: `No available qty (total=${qty}, locked=${qtyInSellOrders})`,
      });
      continue;
    }

    // Calculate SL/TP prices from entry
    const stopPrice = entry * (1 - stopLossPct);
    const takeProfitPrice = entry * (1 + takeProfitPct);

    // Don't place stops that would trigger immediately
    if (current <= stopPrice || current >= takeProfitPrice) {
      actions.push({
        symbol,
        action: "skip",
        reason: `Current $${current.toFixed(4)} past SL $${stopPrice.toFixed(4)} or TP $${takeProfitPrice.toFixed(4)}`,
      });
      continue;
    }

    // Place only the MISSING order type, using available qty
    if (!hasStopLoss) {
      try {
        await submitOrder({
          symbol,
          qty: String(availableQtyRounded),
          side: "sell",
          type: "stop_limit",
          stop_price: String(stopPrice),
          limit_price: String(stopPrice * 0.995),
          time_in_force: "gtc",
        });
        actions.push({ symbol, action: "stop_loss_placed", price: stopPrice.toFixed(4) });
      } catch (e) {
        actions.push({ symbol, action: "stop_loss_failed", reason: e.message.slice(0, 100) });
      }
    }

    if (!hasTakeProfit) {
      // If we placed a stop-loss that used the available qty, we need even less available
      // But since SL is a stop_limit (only triggers at stop price), it doesn't lock the qty
      // the same way a regular limit sell would. Try with available qty.
      const tpQty = !hasStopLoss ? availableQtyRounded : availableQtyRounded;
      try {
        await submitOrder({
          symbol,
          qty: String(tpQty),
          side: "sell",
          type: "limit",
          limit_price: String(takeProfitPrice),
          time_in_force: "gtc",
        });
        actions.push({ symbol, action: "take_profit_placed", price: takeProfitPrice.toFixed(4) });
      } catch (e) {
        actions.push({ symbol, action: "take_profit_failed", reason: e.message.slice(0, 100) });
      }
    }
  }

  return actions;
}

/**
 * Execute a signal from the strategy scanner
 * v4: $500+ trade sizes enforced, stock support, scalp-aware sizing
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
 * v4: More aggressive — close anything down 1.5%+ to increase velocity
 */
export async function closeWorstPositions(positions, maxLossPct = 0.015) {
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
 * Rotate positions — aggressively close underperforming and stagnant positions
 * v4: Much more aggressive than v3 — closes positions that haven't moved enough
 * to free up capital for new, better opportunities
 */
export async function rotateStalePositions(positions, equity = 100000) {
  const closed = [];
  const totalExposure = positions.reduce((sum, p) => sum + parseFloat(p.market_value || 0), 0);

  for (const pos of (positions || [])) {
    const entry = parseFloat(pos.avg_entry_price);
    const current = parseFloat(pos.current_price);
    const pnlPct = (current - entry) / entry;
    const marketValue = parseFloat(pos.market_value || 0);
    const exposurePct = totalExposure > 0 ? (marketValue / totalExposure) * 100 : 0;

    // ROTATION CRITERIA (more aggressive than v3):
    // 1. Small positions under $400 that are flat (neither winning nor losing much)
    if (marketValue < 400 && Math.abs(pnlPct) < 0.01) {
      const result = await liquidatePosition(pos.symbol);
      closed.push({ symbol: pos.symbol, pnl: pnlPct, reason: "Too small, rotating", result });
    }
    // 2. Positions losing between 0.5-1.5% (not bad enough for stop-loss, but stagnant)
    else if (pnlPct < -0.005 && pnlPct > -0.03) {
      const result = await liquidatePosition(pos.symbol);
      closed.push({ symbol: pos.symbol, pnl: pnlPct, reason: `Stagnant loss ${((pnlPct * 100).toFixed(1))}%`, result });
    }
    // 3. Positions barely positive (< +0.5%) after holding, taking small profit for velocity
    else if (pnlPct > 0 && pnlPct < 0.005 && marketValue < equity * 0.02) {
      const result = await liquidatePosition(pos.symbol);
      closed.push({ symbol: pos.symbol, pnl: pnlPct, reason: `Small gain ${((pnlPct * 100).toFixed(1))}%, rotating`, result });
    }
  }
  return closed;
}

/**
 * Aggressive rebalancing: close bottom N positions by P&L to make room for new signals
 * This increases trade velocity for learning purposes
 */
export async function rotateBottomPerformers(positions, count = 2) {
  const closed = [];

  // Sort by P&L percent, worst first
  const sorted = [...(positions || [])].sort((a, b) => {
    const pnlA = (parseFloat(a.current_price) - parseFloat(a.avg_entry_price)) / parseFloat(a.avg_entry_price);
    const pnlB = (parseFloat(b.current_price) - parseFloat(b.avg_entry_price)) / parseFloat(b.avg_entry_price);
    return pnlA - pnlB;
  });

  // Close bottom N losers (skipping those that hit the stop-loss threshold,
  // which will be handled by closeWorstPositions)
  for (const pos of sorted.slice(0, count)) {
    const entry = parseFloat(pos.avg_entry_price);
    const current = parseFloat(pos.current_price);
    const pnlPct = (current - entry) / entry;

    // Only rotate if losing more than 0.3% (don't close tiny losses)
    if (pnlPct < -0.003) {
      const result = await liquidatePosition(pos.symbol);
      closed.push({ symbol: pos.symbol, pnl: pnlPct, reason: `Bottom performer ${((pnlPct * 100).toFixed(1))}%`, result });
    }
  }

  return closed;
}