import { useState, useEffect, useCallback } from 'react';
import { fetchAccount, fetchPositions, fetchOrders, fetchPortfolioHistory, fetchActivities, fetchWeeklyPnL, submitOrder, cancelOrder } from './api';
import AccountCard from './components/AccountCard';
import PositionsTable from './components/PositionsTable';
import OrdersTable from './components/OrdersTable';
import PnLChart from './components/PnLChart';
import TradePanel from './components/TradePanel';
import ActivityLog from './components/ActivityLog';
import BotStatus from './components/BotStatus';
import CryptoScanner from './components/CryptoScanner';

function App() {
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [history, setHistory] = useState(null);
  const [activities, setActivities] = useState([]);
  const [weeklyPnL, setWeeklyPnL] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [acc, pos, ord, hist, act, wkPnl] = await Promise.allSettled([
        fetchAccount(),
        fetchPositions(),
        fetchOrders('open'),
        fetchPortfolioHistory('1M', '1D'),
        fetchActivities(),
        fetchWeeklyPnL(),
      ]);
      if (acc.status === 'fulfilled') setAccount(acc.value);
      else setError('Failed to load account: ' + acc.reason?.message);
      if (pos.status === 'fulfilled') setPositions(Array.isArray(pos.value) ? pos.value : []);
      if (ord.status === 'fulfilled') setOrders(Array.isArray(ord.value) ? ord.value : []);
      if (hist.status === 'fulfilled') setHistory(hist.value);
      if (act.status === 'fulfilled') setActivities(Array.isArray(act.value) ? act.value : []);
      if (wkPnl.status === 'fulfilled') setWeeklyPnL(wkPnl.value);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setLastRefresh(Date.now());
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleTrade = async (symbol, qty, side) => {
    try {
      await submitOrder(symbol, qty, side);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleCancelOrder = async (orderId) => {
    try {
      await cancelOrder(orderId);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  const formatMoney = (val) => {
    if (val === null || val === undefined) return '$—';
    const num = typeof val === 'string' ? parseFloat(val) : val;
    return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const pnlColor = (val) => {
    if (val === null || val === undefined) return 'text-[#8b8fa3]';
    const num = typeof val === 'string' ? parseFloat(val) : val;
    return num >= 0 ? 'text-[#00c853]' : 'text-[#ff1744]';
  };

  if (loading && !account) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">📈</div>
          <div className="text-[#8b8fa3] text-lg">Loading trading dashboard...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1117]">
      {/* Header */}
      <header className="border-b border-[#2d3148] px-6 py-4">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🚀</span>
            <h1 className="text-xl font-bold text-white">Alpaca Crypto Trader</h1>
            <span className="text-xs bg-[#7c4dff]/20 text-[#7c4dff] px-2 py-0.5 rounded-full ml-2">PAPER</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-[#8b8fa3]">
              Last refresh: {new Date(lastRefresh).toLocaleTimeString()}
            </span>
            <button
              onClick={refresh}
              className="px-3 py-1.5 bg-[#252836] hover:bg-[#2d3148] rounded-lg text-sm transition-colors border border-[#2d3148]"
            >
              ↻ Refresh
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="border-b border-[#2d3148] px-6">
        <div className="max-w-[1440px] mx-auto flex gap-1">
          {[
            { id: 'dashboard', label: '📊 Dashboard' },
            { id: 'bot', label: '🤖 Trading Bot' },
            { id: 'scanner', label: '🔍 Scanner' },
            { id: 'positions', label: '💼 Positions' },
            { id: 'orders', label: '📋 Orders' },
            { id: 'trade', label: '⚡ Trade' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
                activeTab === tab.id
                  ? 'text-[#448aff] border-[#448aff]'
                  : 'text-[#8b8fa3] border-transparent hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Error Banner */}
      {error && (
        <div className="max-w-[1440px] mx-auto px-6 mt-4">
          <div className="bg-[#ff1744]/10 border border-[#ff1744]/30 text-[#ff1744] px-4 py-2 rounded-lg text-sm">
            ⚠️ {error}
          </div>
        </div>
      )}

      {/* Content */}
      <main className="max-w-[1440px] mx-auto px-6 py-6">
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <AccountCard title="Portfolio Value" value={formatMoney(account?.equity)} subtitle={account?.currency || 'USD'} icon="💰" />
              <AccountCard title="Cash Balance" value={formatMoney(account?.cash)} subtitle={`Buying power: ${formatMoney(account?.buying_power)}`} icon="💵" />
              <AccountCard
                title="Today's P&L"
                value={`${account ? (parseFloat(account.equity) - parseFloat(account.last_mkt_value || 0) >= 0 ? '+' : '') : ''}${
                  account ? formatMoney(parseFloat(account.equity) - parseFloat(account.last_mkt_value || 0)) : '$—'
                }`}
                valueClass={pnlColor(account ? parseFloat(account.equity) - parseFloat(account.last_mkt_value || 0) : 0)}
                icon="📈"
              />
              <AccountCard
                title="Weekly P&L"
                value={weeklyPnL ? `${weeklyPnL.pnl >= 0 ? '+' : ''}${formatMoney(weeklyPnL.pnl)}` : '$—'}
                valueClass={pnlColor(weeklyPnL?.pnl || 0)}
                subtitle={weeklyPnL ? `${weeklyPnL.pnlPct >= 0 ? '+' : ''}${weeklyPnL.pnlPct.toFixed(2)}% (7d)` : 'loading...'}
                icon="📅"
              />
              <AccountCard title="Open Positions" value={positions.length} subtitle={`${orders.length} pending orders`} icon="📊" />
            </div>
            <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] p-4">
              <h3 className="text-sm font-medium text-[#8b8fa3] mb-4">Portfolio History (30d)</h3>
              <PnLChart history={history} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <h3 className="text-sm font-medium text-[#8b8fa3] mb-3">Open Positions</h3>
                <PositionsTable positions={positions} />
              </div>
              <div>
                <h3 className="text-sm font-medium text-[#8b8fa3] mb-3">Recent Activity</h3>
                <ActivityLog activities={activities} />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'bot' && (
          <div className="max-w-2xl mx-auto space-y-6">
            <h2 className="text-lg font-semibold text-white">🤖 Automated Trading Bot</h2>
            <BotStatus />
          </div>
        )}

        {activeTab === 'scanner' && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-white">🔍 Crypto Pair Scanner</h2>
            <p className="text-sm text-[#8b8fa3]">Scans 15 crypto pairs using RSI, MACD, volume, and volatility filters. Identifies candidates for 2-8% daily profit target.</p>
            <CryptoScanner />
          </div>
        )}

        {activeTab === 'positions' && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-white">Open Positions</h2>
            <PositionsTable positions={positions} detailed />
          </div>
        )}

        {activeTab === 'orders' && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-white">Open Orders</h2>
            <OrdersTable orders={orders} onCancel={handleCancelOrder} />
          </div>
        )}

        {activeTab === 'trade' && (
          <TradePanel onTrade={handleTrade} positions={positions} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#2d3148] px-6 py-3 mt-8">
        <p className="text-center text-xs text-[#8b8fa3]">
          Alpaca Paper Trading · Crypto Only · Risk Management Is Key · Bot runs every 5 min
        </p>
      </footer>
    </div>
  );
}

export default App;