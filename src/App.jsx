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
import {
  RefreshCw,
  TrendingUp,
  DollarSign,
  BarChart3,
  Briefcase,
  Clock,
  Wallet,
  LineChart,
} from "lucide-react";
import PositionsTable from "./components/PositionsTable";
import OrdersTable from "./components/OrdersTable";
import TradePanel from "./components/TradePanel";
import PnLChart from "./components/PnLChart";
import ActivityLog from "./components/ActivityLog";

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

function AccountBar({ account }) {
  if (!account) return null;
  const equity = parseFloat(account.equity || 0);
  const pnl =
    parseFloat(account.equity || 0) - parseFloat(account.last_equity || 0);
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
        <div className="label">Long Market Value</div>
        <div className="value">{formatCurrency(account.long_market_value)}</div>
      </div>
      <div className="account-stat">
        <div className="label">Buying Power</div>
        <div className="value">{formatCurrency(account.buying_power)}</div>
      </div>
      <div className="account-stat">
        <div className="label">Market Status</div>
        <div className="value" style={{ fontSize: "16px" }}>
          <span className={`status-dot ${account.market_open ? "live" : "offline"}`}></span>
          {account.market_open ? " Open" : " Closed"}
        </div>
      </div>
    </div>
  );
}

function TabNav({ activeTab, onTabChange }) {
  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: BarChart3 },
    { id: "positions", label: "Positions", icon: Briefcase },
    { id: "orders", label: "Orders", icon: Clock },
    { id: "trade", label: "Trade", icon: Wallet },
    { id: "history", label: "History", icon: LineChart },
  ];

  return (
    <div className="tab-nav">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={`tab-btn ${activeTab === id ? "active" : ""}`}
          onClick={() => onTabChange(id)}
        >
          <Icon size={16} />
          {label}
        </button>
      ))}
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
            "API error -- check your Alpaca keys in Netlify env vars (ALPACA_API_KEY, ALPACA_SECRET_KEY)"
        );
      }
      setAccount(acct && !acct.code ? acct : null);
      setPositions(Array.isArray(pos) ? pos : []);
      setOrders(Array.isArray(ords) ? ords : []);
      setTrades(Array.isArray(trds) ? trds : []);
      setPortfolioHistory(hist);
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

  const handleTrade = async (symbol, qty, side, type) => {
    const result = await submitOrder(symbol, qty, side, type);
    if (result && result.code) {
      throw new Error(result.message || "Order failed");
    }
    setTimeout(loadAll, 1500);
    return result;
  };

  const handleCancelOrder = async (orderId) => {
    await cancelOrder(orderId);
    setTimeout(loadAll, 1000);
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
        <button
          className={`refresh-btn ${spinning ? "spinning" : ""}`}
          onClick={loadAll}
        >
          <RefreshCw size={14} />
          Refresh {lastRefresh && ` \u00b7 ${lastRefresh}`}
        </button>
      </div>

      {error && <div className="error-msg">{error}</div>}

      <AccountBar account={account} />

      <TabNav activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="tab-content">
        {activeTab === "dashboard" && (
          <>
            <div className="section">
              <div className="section-header">
                <h2>
                  <LineChart size={18} style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }} />
                  Portfolio Performance
                </h2>
              </div>
              <PnLChart history={portfolioHistory} />
            </div>

            <div className="section">
              <div className="section-header">
                <h2>
                  <Briefcase size={18} style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }} />
                  Open Positions
                </h2>
              </div>
              <PositionsTable positions={positions} detailed />
            </div>

            <div className="section">
              <div className="section-header">
                <h2>
                  <Clock size={18} style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }} />
                  Recent Orders
                </h2>
              </div>
              <OrdersTable orders={orders.slice(0, 5)} onCancel={handleCancelOrder} />
            </div>

            <div className="section">
              <div className="section-header">
                <h2>
                  <DollarSign size={18} style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }} />
                  Recent Activity
                </h2>
              </div>
              <ActivityLog activities={trades} />
            </div>
          </>
        )}

        {activeTab === "positions" && (
          <div className="section">
            <PositionsTable positions={positions} detailed />
          </div>
        )}

        {activeTab === "orders" && (
          <div className="section">
            <OrdersTable orders={orders} onCancel={handleCancelOrder} />
          </div>
        )}

        {activeTab === "trade" && (
          <div className="section">
            <TradePanel onTrade={handleTrade} positions={positions} />
          </div>
        )}

        {activeTab === "history" && (
          <>
            <div className="section">
              <div className="section-header">
                <h2>
                  <LineChart size={18} style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }} />
                  30-Day Equity Curve
                </h2>
              </div>
              <PnLChart history={portfolioHistory} />
            </div>
            <div className="section">
              <div className="section-header">
                <h2>
                  <DollarSign size={18} style={{ display: "inline", verticalAlign: "middle", marginRight: 8 }} />
                  Trade History
                </h2>
              </div>
              <ActivityLog activities={trades} />
            </div>
          </>
        )}
      </div>

      <div className="footer">
        Alpaca Paper Trading Dashboard &middot; Crypto Only &middot; Auto-refreshes every 30s
      </div>
    </div>
  );
}
