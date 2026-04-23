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
import AdvancedCharts from './components/AdvancedCharts';
import PerformanceAnalytics from './components/PerformanceAnalytics';
import RSIChart from './components/RSIChart';
import MACDChart from './components/MACDChart';
import PnLBreakdownChart from './components/PnLBreakdownChart';
import CryptoTicker from './components/CryptoTicker';
import RiskDashboard from './components/RiskDashboard';
import TradeAlerts from './components/TradeAlerts';
import DailyPnLTarget from './components/DailyPnLTarget';

function ThemeToggle({ theme, toggleTheme }) {
  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] transition-colors"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      {theme === 'dark' ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-secondary)]">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/>
          <line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/>
          <line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-secondary)]">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      )}
    </button>
  );
}

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
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('theme') || 'dark';
    }
    return 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
    // Poll every 20 seconds for near-real-time dashboard updates
    const interval = setInterval(refresh, 20000);
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

  const handleTickerClick = (symbol) => {
    setSelectedSymbol(symbol);
    setActiveTab('trade');
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
    if (val === null || val === undefined) return 'text-[var(--text-muted)]';
    const num = typeof val === 'string' ? parseFloat(val) : val;
    return num >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]';
  };

  const tabs = [
    { id: 'dashboard', label: '📊 Dashboard' },
    { id: 'bot', label: '🤖 Bot' },
    { id: 'scanner', label: '🔍 Scanner' },
    { id: 'charts', label: '📈 Charts' },
    { id: 'analytics', label: '📊 Analytics' },
    { id: 'risk', label: '🛡️ Risk' },
    { id: 'pnl', label: '💹 P&L' },
    { id: 'positions', label: '💼 Positions' },
    { id: 'orders', label: '📋 Orders' },
    { id: 'trade', label: '⚡ Trade' },
  ];

  if (loading && !account) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <div className="text-center">
          <div className="text-4xl mb-4">📈</div>
          <div className="text-[var(--text-secondary)] text-lg">Loading trading dashboard...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Trade Alerts (toast overlay) */}
      <TradeAlerts />

      {/* Header */}
      <header className="border-b border-[var(--border)] px-4 md:px-6 py-3 md:py-4">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🚀</span>
            <h1 className="text-lg md:text-xl font-bold text-[var(--text-primary)]">Alpaca Crypto Trader</h1>
            <span className="text-xs bg-[var(--accent-blue)]/20 text-[var(--accent-blue)] px-2 py-0.5 rounded-full ml-2">PAPER</span>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            <span className="hidden md:inline text-xs text-[var(--text-muted)]">
              Last refresh: {new Date(lastRefresh).toLocaleTimeString()}
            </span>
            <button
              onClick={refresh}
              className="px-3 py-1.5 bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] rounded-lg text-sm transition-colors border border-[var(--border)]"
            >
              ↻ Refresh
            </button>
            <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
          </div>
        </div>
      </header>

      {/* Crypto Price Ticker Bar */}
      <CryptoTicker onSymbolClick={handleTickerClick} />

      {/* Tabs */}
      <nav className="border-b border-[var(--border)]">
        {/* Desktop tabs */}
        <div className="hidden md:block px-6">
          <div className="max-w-[1440px] mx-auto flex gap-1 overflow-x-auto">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'text-[var(--accent-blue)] border-[var(--accent-blue)]'
                    : 'text-[var(--text-muted)] border-transparent hover:text-[var(--text-primary)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        {/* Mobile tabs - scrollable */}
        <div className="md:hidden px-4 py-2">
          <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); }}
                className={`px-3 py-2 text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)] border border-[var(--accent-blue)]/50'
                    : 'bg-[var(--bg-card)] text-[var(--text-muted)] border border-[var(--border)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Error Banner */}
      {error && (
        <div className="max-w-[1440px] mx-auto px-4 md:px-6 mt-4">
          <div className="bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/30 text-[var(--accent-red)] px-4 py-2 rounded-lg text-sm">
            ⚠️ {error}
          </div>
        </div>
      )}

      {/* Content */}
      <main className="max-w-[1440px] mx-auto px-4 md:px-6 py-4 md:py-6">
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
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
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-3 md:p-4">
              <h3 className="text-sm font-medium text-[var(--text-muted)] mb-4">Portfolio History (30d)</h3>
              <PnLChart history={history} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
              <div className="lg:col-span-2">
                <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">Open Positions</h3>
                <PositionsTable positions={positions} />
              </div>
              <div>
                <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">Recent Activity</h3>
                <ActivityLog activities={activities} />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'bot' && (
          <div className="max-w-2xl mx-auto space-y-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">🤖 Automated Trading Bot</h2>
            <BotStatus />
          </div>
        )}

        {activeTab === 'charts' && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">📈 Advanced Charts</h2>
            <AdvancedCharts />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
              <div className="bg-[var(--bg-primary)] rounded-xl border border-[var(--border)] p-3 md:p-4">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">RSI Indicator</h3>
                <RSIChart />
              </div>
              <div className="bg-[var(--bg-primary)] rounded-xl border border-[var(--border)] p-3 md:p-4">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">MACD Indicator</h3>
                <MACDChart />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">📊 Trade Performance Analytics</h2>
            <PerformanceAnalytics />
          </div>
        )}

        {activeTab === 'risk' && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">🛡️ Risk Dashboard</h2>
            <DailyPnLTarget />
            <RiskDashboard />
          </div>
        )}

        {activeTab === 'pnl' && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">💹 Profit & Loss Breakdown</h2>
            <PnLBreakdownChart />
          </div>
        )}

        {activeTab === 'scanner' && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">🔍 Crypto Pair Scanner</h2>
            <p className="text-sm text-[var(--text-muted)]">Scans 15 crypto pairs using RSI, MACD, volume, and volatility filters. Identifies candidates for 2-8% daily profit target.</p>
            <CryptoScanner />
          </div>
        )}

        {activeTab === 'positions' && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Open Positions</h2>
            <PositionsTable positions={positions} detailed />
          </div>
        )}

        {activeTab === 'orders' && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Open Orders</h2>
            <OrdersTable orders={orders} onCancel={handleCancelOrder} />
          </div>
        )}

        {activeTab === 'trade' && (
          <div className="w-full lg:max-w-lg mx-auto">
            <TradePanel onTrade={handleTrade} positions={positions} defaultSymbol={selectedSymbol} onSymbolSelected={() => setSelectedSymbol(null)} />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] px-4 md:px-6 py-3 mt-8">
        <p className="text-center text-xs text-[var(--text-muted)]">
          Alpaca Paper Trading · Crypto Only · Risk Management Is Key · Bot runs every 5 min
        </p>
      </footer>
    </div>
  );
}

export default App;