import { useState, useEffect, useCallback } from "react";
import {
  fetchAccount,
  fetchPositions,
  fetchOrders,
  fetchActivities,
} from "./api";
import { RefreshCw, TrendingUp, DollarSign, BarChart3, Briefcase, Clock } from "lucide-react";

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
  const equity = parseFloat(account.equity || 0);
  const cash = parseFloat(account.cash || 0);
  const pnl = parseFloat(account.equity || 0) - parseFloat(account.last_equity || 0);
  const pnlPct = parseFloat(account.last_equity || 0) > 0
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
          {" "}{account.market_open ? "Open" : "Closed"}
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

function OrdersTable({ orders }) {
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

export default function App() {
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  const loadAll = useCallback(async () => {
    setSpinning(true);
    setError(null);
    try {
      const [acct, pos, ords, trds] = await Promise.all([
        fetchAccount().catch(() => null),
        fetchPositions().catch(() => []),
        fetchOrders("open").catch(() => []),
        fetchActivities().catch(() => []),
      ]);
      if (acct && acct.code) {
        setError(acct.message || "API error — check your Alpaca keys in Netlify env vars (ALPACA_API_KEY, ALPACA_SECRET_KEY)");
      }
      setAccount(acct && !acct.code ? acct : null);
      setPositions(Array.isArray(pos) ? pos : []);
      setOrders(Array.isArray(ords) ? ords : []);
      setTrades(Array.isArray(trds) ? trds : []);
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
        <button
          className={`refresh-btn ${spinning ? "spinning" : ""}`}
          onClick={loadAll}
        >
          <RefreshCw size={14} />
          Refresh {lastRefresh && `· ${lastRefresh}`}
        </button>
      </div>

      {error && <div className="error-msg">{error}</div>}

      <AccountBar account={account} />

      <div className="section">
        <div className="section-header">
          <h2><Briefcase size={18} style={{display:"inline",verticalAlign:"middle",marginRight:8}}/>Open Positions</h2>
        </div>
        <PositionsGrid positions={positions} />
      </div>

      <div className="section">
        <div className="section-header">
          <h2><Clock size={18} style={{display:"inline",verticalAlign:"middle",marginRight:8}}/>Open Orders</h2>
        </div>
        <OrdersTable orders={orders} />
      </div>

      <div className="section">
        <div className="section-header">
          <h2><DollarSign size={18} style={{display:"inline",verticalAlign:"middle",marginRight:8}}/>Trade History</h2>
        </div>
        <TradeHistory trades={trades} />
      </div>

      <div className="footer">
        Alpaca Paper Trading Dashboard · Crypto Only · Auto-refreshes every 30s
      </div>
    </div>
  );
}