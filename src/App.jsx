import { useState, useEffect, useCallback } from "react";
import {
  fetchAccount,
  fetchPositions,
  fetchOrders,
  fetchActivities,
  fetchPortfolioHistory,
  submitOrder,
  cancelOrder,
} from "./api";
import PnLChart from "./components/PnLChart";
import TradePanel from "./components/TradePanel";
import {
  RefreshCw,
  TrendingUp,
  DollarSign,
  BarChart3,
  Briefcase,
  Clock,
  Activity,
  Zap,
  Calendar,
} from "lucide-react";

function formatCurrency(val) {
  if (val == null) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(parseFloat(val));
}

function formatPercent(val) {
  if (val == null) return "0.00%";
  const n = parseFloat(val);
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function AccountBar({ account }) {
  if (!account) return null;
  const pnl = parseFloat(account.equity || 0) - parseFloat(account.last_equity || 0);
  const pnlPct =
    parseFloat(account.last_equity || 0) > 0
      ? (pnl / parseFloat(account.last_equity)) * 100
      : 0;

  return (
    <div className="account-bar">
      <div className="account-stat">
        <div className="label">Portfolio Value</div>
        <div className="value">{formatCurrency(account.equity)}</div>
      </div>
      <div className="account-stat">
        <div className="label">Cash Available</div>
        <div className="value">{formatCurrency(account.cash)}</div>
      </div>
      <div className="account-stat">
        <div className="label">Today's P&L</div>
        <div className={`value ${pnl >= 0 ? "positive" : "negative"}`}>
          {formatCurrency(pnl)} ({formatPercent(pnlPct)})
        </div>
      </div>
      <div className="account-stat">
        <div className="label">Buying Power</div>
        <div className="value">{formatCurrency(account.buying_power)}</div>
      </div>
      <div className="account-stat">
        <div className="label">Market Status</div>
        <div className="value" style={{ fontSize: "16px" }}>
          <span className={`status-dot ${account.market_open ? "live" : "offline"}`}></span>
          {" "}
          {account.market_open ? "Open" : "Closed"}
        </div>
      </div>
    </div>
  );
}

function PositionsGrid({ positions }) {
  if (!positions || positions.length === 0) {
    return (
      <div className="empty-state">
        <div className="icon"><Briefcase size={48} /></div>
        <p>No open positions</p>
      </div>
    );
  }

  return (
    <div className="positions-grid">
      {positions.map((p) => {
        const unrealizedPnl = parseFloat(p.unrealized_pl || 0);
        const unrealizedPnlPct = parseFloat(p.unrealized_plpc || 0);
        const isLong = parseFloat(p.qty) > 0;

        return (
          <div key={p.asset_id} className="position-card">
            <div className="symbol">
              {p.symbol}
              <span className={`side ${isLong ? "long" : "short"}`}>
                {isLong ? "LONG" : "SHORT"}
              </span>
            </div>
            <div className="position-details">
              <div className="detail">
                <span className="detail-label">Qty</span>
                <span className="detail-value">{parseFloat(p.qty).toFixed(6)}</span>
              </div>
              <div className="detail">
                <span className="detail-label">Avg Entry</span>
                <span className="detail-value">{formatCurrency(p.avg_entry_price)}</span>
              </div>
              <div className="detail">
                <span className="detail-label">Current</span>
                <span className="detail-value">{formatCurrency(p.current_price)}</span>
              </div>
              <div className="detail">
                <span className="detail-label">Value</span>
                <span className="detail-value">{formatCurrency(p.market_value)}</span>
              </div>
              <div className="detail">
                <span className="detail-label">Unrealized P&L</span>
                <span className={`detail-value ${unrealizedPnl >= 0 ? "positive" : "negative"}`}>
                  {formatCurrency(unrealizedPnl)} ({formatPercent(unrealizedPnlPct * 100)})
                </span>
              </div>
              <div className="detail">
                <span className="detail-label">Change</span>
                <span className={`detail-value ${unrealizedPnlPct >= 0 ? "positive" : "negative"}`}>
                  {formatPercent(unrealizedPnlPct * 100)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OrdersTable({ orders, onCancel }) {
  if (!orders || orders.length === 0) {
    return (
      <div className="empty-state">
        <div className="icon"><Clock size={48} /></div>
        <p>No open orders</p>
      </div>
    );
  }

  return (
    <div className="orders-table">
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Side</th>
            <th>Qty</th>
            <th>Type</th>
            <th>Limit</th>
            <th>Filled</th>
            <th>Status</th>
            <th>Submitted</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td><strong>{o.symbol}</strong></td>
              <td><span className={`badge ${o.side}`}>{o.side.toUpperCase()}</span></td>
              <td>{o.qty}</td>
              <td>{o.type}</td>
              <td>{o.limit_price ? formatCurrency(o.limit_price) : "—"}</td>
              <td>{o.filled_qty || 0}/{o.qty}</td>
              <td><span className={`badge ${o.status === "filled" ? "filled" : "pending"}`}>{o.status}</span></td>
              <td>{formatDate(o.submitted_at)}</td>
              <td>
                {o.status !== "filled" && onCancel && (
                  <button
                    onClick={() => onCancel(o.id)}
                    className="cancel-btn"
                    title="Cancel order"
                  >
                    ✕
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TradeHistory({ trades }) {
  if (!trades || trades.length === 0) {
    return (
      <div className="empty-state">
        <div className="icon"><BarChart3 size={48} /></div>
        <p>No trade history yet</p>
      </div>
    );
  }

  return (
    <div className="trade-history">
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Side</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Total</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {trades.slice(0, 50).map((t, i) => (
            <tr key={i}>
              <td><strong>{t.symbol}</strong></td>
              <td><span className={`badge ${t.side}`}>{t.side?.toUpperCase()}</span></td>
              <td>{t.qty}</td>
              <td>{formatCurrency(t.price)}</td>
              <td>{formatCurrency(parseFloat(t.price || 0) * parseFloat(t.qty || 0))}</td>
              <td>{formatDate(t.transaction_timestamp || t.timestamp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PnLBreakdown({ history, account }) {
  if (!history || !history.equity || history.equity.length === 0) {
    return (
      <div className="empty-state">
        <div className="icon"><DollarSign size={48} /></div>
        <p>P&L data will appear once trading begins</p>
      </div>
    );
  }

  const equity = history.equity.map((v) => parseFloat(v));
  const timestamps = history.timestamp;

  const latest = equity[equity.length - 1];
  const startVal = equity[0];

  // Total P&L
  const totalPnl = latest - startVal;
  const totalPnlPct = startVal > 0 ? (totalPnl / startVal) * 100 : 0;

  // Daily P&L (last data point vs previous day)
  let dailyPnl = 0;
  let dailyPnlPct = 0;
  if (equity.length >= 2) {
    const todayStart = equity[equity.length - 2];
    dailyPnl = latest - todayStart;
    dailyPnlPct = todayStart > 0 ? (dailyPnl / todayStart) * 100 : 0;
  }

  // Weekly P&L (last 5 trading days vs 5 days ago)
  let weeklyPnl = 0;
  let weeklyPnlPct = 0;
  if (equity.length >= 5) {
    const weekAgo = equity[equity.length - 6];
    weeklyPnl = latest - weekAgo;
    weeklyPnlPct = weekAgo > 0 ? (weeklyPnl / weekAgo) * 100 : 0;
  } else if (equity.length > 1) {
    weeklyPnl = totalPnl;
    weeklyPnlPct = totalPnlPct;
  }

  // Build per-day breakdown
  const dailyBreakdown = [];
  for (let i = 1; i < equity.length; i++) {
    const dayPnl = equity[i] - equity[i - 1];
    const dayPnlPct = equity[i - 1] > 0 ? (dayPnl / equity[i - 1]) * 100 : 0;
    dailyBreakdown.push({
      date: new Date(timestamps[i] * 1000).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      pnl: dayPnl,
      pnlPct: dayPnlPct,
      equity: equity[i],
    });
  }

  return (
    <div className="pnl-breakdown">
      <div className="pnl-summary-grid">
        <div className="pnl-summary-card">
          <div className="pnl-summary-label">
            <Calendar size={14} /> Daily P&L
          </div>
          <div className={`pnl-summary-value ${dailyPnl >= 0 ? "positive" : "negative"}`}>
            {formatCurrency(dailyPnl)} ({formatPercent(dailyPnlPct)})
          </div>
        </div>
        <div className="pnl-summary-card">
          <div className="pnl-summary-label">
            <Calendar size={14} /> Weekly P&L
          </div>
          <div className={`pnl-summary-value ${weeklyPnl >= 0 ? "positive" : "negative"}`}>
            {formatCurrency(weeklyPnl)} ({formatPercent(weeklyPnlPct)})
          </div>
        </div>
        <div className="pnl-summary-card">
          <div className="pnl-summary-label">
            <TrendingUp size={14} /> Total P&L (Period)
          </div>
          <div className={`pnl-summary-value ${totalPnl >= 0 ? "positive" : "negative"}`}>
            {formatCurrency(totalPnl)} ({formatPercent(totalPnlPct)})
          </div>
        </div>
      </div>

      {dailyBreakdown.length > 0 && (
        <div className="pnl-daily-table">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Equity</th>
                <th>Day P&L</th>
                <th>Day %</th>
              </tr>
            </thead>
            <tbody>
              {[...dailyBreakdown].reverse().map((d, i) => (
                <tr key={i}>
                  <td>{d.date}</td>
                  <td>{formatCurrency(d.equity)}</td>
                  <td className={d.pnl >= 0 ? "positive" : "negative"}>
                    {formatCurrency(d.pnl)}
                  </td>
                  <td className={d.pnlPct >= 0 ? "positive" : "negative"}>
                    {formatPercent(d.pnlPct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [trades, setTrades] = useState([]);
  const [portfolioHistory, setPortfolioHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [activeTab, setActiveTab] = useState("dashboard");

  const loadAll = useCallback(async () => {
    setSpinning(true);
    setError(null);
    try {
      const [acct, pos, ords, trds, hist] = await Promise.all([
        fetchAccount().catch(() => null),
        fetchPositions().catch(() => []),
        fetchOrders("open").catch(() => []),
        fetchActivities().catch(() => []),
        fetchPortfolioHistory("1M", "1D").catch(() => null),
      ]);
      if (acct && acct.code) {
        setError(
          acct.message ||
            "API error — check your Alpaca keys in Netlify env vars (ALPACA_API_KEY, ALPACA_SECRET_KEY)"
        );
      }
      setAccount(acct && !acct.code ? acct : null);
      setPositions(Array.isArray(pos) ? pos : []);
      setOrders(Array.isArray(ords) ? ords : []);
      setTrades(Array.isArray(trds) ? trds : []);
      setPortfolioHistory(hist && !hist.code ? hist : null);
      setLastRefresh(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
    setSpinning(false);
  }, []);

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadAll, 30000);
    return () => clearInterval(interval);
  }, [loadAll]);

  const handleTrade = async (symbol, qty, side, type = "market") => {
    const result = await submitOrder(symbol, qty, side, type);
    if (result.code) {
      throw new Error(result.message || "Order failed");
    }
    setTimeout(loadAll, 2000);
    return result;
  };

  const handleCancelOrder = async (orderId) => {
    await cancelOrder(orderId);
    setTimeout(loadAll, 1500);
  };

  if (loading) {
    return (
      <div className="app">
        <div className="loading">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="header">
        <h1>
          <TrendingUp size={28} />
          Alpaca <span>Crypto</span> Dashboard
        </h1>
        <div className="header-right">
          <div className="tab-bar">
            <button
              className={`tab ${activeTab === "dashboard" ? "active" : ""}`}
              onClick={() => setActiveTab("dashboard")}
            >
              <Activity size={14} /> Dashboard
            </button>
            <button
              className={`tab ${activeTab === "trade" ? "active" : ""}`}
              onClick={() => setActiveTab("trade")}
            >
              <Zap size={14} /> Trade
            </button>
          </div>
          <button
            className={`refresh-btn ${spinning ? "spinning" : ""}`}
            onClick={loadAll}
          >
            <RefreshCw size={14} />
            Refresh {lastRefresh && `· ${lastRefresh}`}
          </button>
        </div>
      </div>

      {error && <div className="error-msg">{error}</div>}

      {activeTab === "dashboard" && (
        <>
          <AccountBar account={account} />

          {/* P&L Section */}
          <div className="section">
            <div className="section-header">
              <h2>
                <DollarSign
                  size={18}
                  style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }}
                />
                P&L Breakdown
              </h2>
            </div>
            <PnLBreakdown history={portfolioHistory} account={account} />
          </div>

          {/* Portfolio Chart */}
          <div className="section">
            <div className="section-header">
              <h2>
                <BarChart3
                  size={18}
                  style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }}
                />
                Portfolio Equity Chart
              </h2>
            </div>
            <PnLChart history={portfolioHistory} />
          </div>

          <div className="section">
            <div className="section-header">
              <h2>
                <Briefcase
                  size={18}
                  style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }}
                />
                Open Positions
              </h2>
            </div>
            <PositionsGrid positions={positions} />
          </div>

          <div className="section">
            <div className="section-header">
              <h2>
                <Clock
                  size={18}
                  style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }}
                />
                Open Orders
              </h2>
            </div>
            <OrdersTable orders={orders} onCancel={handleCancelOrder} />
          </div>

          <div className="section">
            <div className="section-header">
              <h2>
                <DollarSign
                  size={18}
                  style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }}
                />
                Trade History
              </h2>
            </div>
            <TradeHistory trades={trades} />
          </div>
        </>
      )}

      {activeTab === "trade" && (
        <TradePanel onTrade={handleTrade} positions={positions} />
      )}

      <div className="footer">
        Alpaca Paper Trading Dashboard · Crypto Only · Auto-refreshes every 30s
      </div>
    </div>
  );
}