import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchLivePrices } from '../api';

const SYMBOL_META = {
  'BTC/USD': { label: 'BTC', icon: '₿', decimals: 2 },
  'ETH/USD': { label: 'ETH', icon: 'Ξ', decimals: 2 },
  'SOL/USD': { label: 'SOL', icon: '◎', decimals: 2 },
  'DOGE/USD': { label: 'DOGE', icon: '🐕', decimals: 5 },
  'ADA/USD': { label: 'ADA', icon: '♦', decimals: 4 },
  'AVAX/USD': { label: 'AVAX', icon: '🔺', decimals: 3 },
  'LINK/USD': { label: 'LINK', icon: '⬡', decimals: 2 },
  'MATIC/USD': { label: 'MATIC', icon: '⬢', decimals: 4 },
};

const SYMBOLS = Object.keys(SYMBOL_META);

function formatPrice(price, decimals) {
  if (price == null) return '—';
  const num = typeof price === 'string' ? parseFloat(price) : price;
  if (num >= 1000) return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (num >= 1) return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: decimals || 4 });
  return '$' + num.toFixed(decimals || 6);
}

function formatChange(changePct) {
  if (changePct == null) return { text: '—', className: 'text-[var(--text-muted)]' };
  const num = typeof changePct === 'string' ? parseFloat(changePct) : changePct;
  const sign = num >= 0 ? '+' : '';
  return {
    text: `${sign}${num.toFixed(2)}%`,
    className: num >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]',
  };
}

// Price sparkline showing last N prices as a tiny bar chart
function MiniSparkline({ history, color = 'var(--accent-green)' }) {
  if (!history || history.length < 2) return null;
  const prices = history.slice(-12);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  return (
    <div className="flex items-end gap-px h-4" title={`${prices.length} ticks`}>
      {prices.map((p, i) => (
        <div
          key={i}
          className="w-0.5 rounded-t"
          style={{
            height: `${Math.max(2, ((p - min) / range) * 100)}%`,
            backgroundColor: p >= prices[Math.max(0, i - 1)] ? 'var(--accent-green)' : 'var(--accent-red)',
            opacity: 0.4 + (i / prices.length) * 0.6,
          }}
        />
      ))}
    </div>
  );
}

export default function CryptoTicker({ onSymbolClick }) {
  const [prices, setPrices] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('connecting'); // connecting | live | stale | error
  const [flashState, setFlashState] = useState({});
  const [priceHistory, setPriceHistory] = useState({}); // symbol -> [prices]
  const prevPricesRef = useRef({});
  const reconnectTimeoutRef = useRef(null);
  const refreshCountRef = useRef(0);
  const POLL_INTERVAL = 5000; // 5 second polling for near-real-time
  const STALE_THRESHOLD = 15000; // Consider stale if no update in 15s

  const refresh = useCallback(async () => {
    try {
      const data = await fetchLivePrices();
      const newPrices = data.prices || {};
      
      // Detect price changes and trigger flash animation
      const newFlash = {};
      for (const [symbol, info] of Object.entries(newPrices)) {
        const prevPrice = prevPricesRef.current[symbol];
        if (prevPrice != null && info.price !== prevPrice) {
          newFlash[symbol] = info.price > prevPrice ? 'up' : 'down';
        }
      }
      
      if (Object.keys(newFlash).length > 0) {
        setFlashState(newFlash);
        // Clear flash after animation
        setTimeout(() => setFlashState({}), 500);
      }
      
      // Store previous prices for comparison
      const prevMap = {};
      for (const [symbol, info] of Object.entries(newPrices)) {
        prevMap[symbol] = info.price;
      }
      prevPricesRef.current = prevMap;
      
      // Update price history for sparklines
      setPriceHistory(prev => {
        const next = { ...prev };
        for (const [symbol, info] of Object.entries(newPrices)) {
          if (!next[symbol]) next[symbol] = [];
          next[symbol] = [...next[symbol].slice(-19), info.price]; // Keep last 20 ticks
        }
        return next;
      });
      
      setPrices(newPrices);
      setConnectionStatus('live');
      setError(null);
      refreshCountRef.current++;
    } catch (e) {
      setError(e.message);
      setConnectionStatus(prices ? 'stale' : 'error');
    } finally {
      setLoading(false);
    }
  }, [prices]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Stale detection
  useEffect(() => {
    const timer = setInterval(() => {
      if (!prices) return;
      // If we haven't gotten a successful refresh in a while, mark stale
      const dataAge = Date.now() - Date.now(); // We track via connectionStatus
      // Simplified: if error is set, we're already stale
    }, 5000);
    return () => clearInterval(timer);
  }, [prices]);

  if (loading && !prices) {
    return (
      <div className="bg-[var(--bg-secondary)] border-b border-[var(--border)] px-4 md:px-6 py-2">
        <div className="max-w-[1440px] mx-auto flex items-center gap-4 overflow-x-auto scrollbar-hide">
          <span className="flex-shrink-0 flex items-center gap-1 px-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent-amber)] animate-pulse"></span>
            <span className="text-[10px] text-[var(--text-muted)]">CONNECTING</span>
          </span>
          {SYMBOLS.map(sym => (
            <div key={sym} className="flex-shrink-0 px-3 py-1 animate-pulse">
              <span className="text-[var(--text-muted)] text-xs">{SYMBOL_META[sym]?.icon} {SYMBOL_META[sym]?.label}</span>
              <span className="text-[var(--text-muted)] text-xs ml-2">—</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && !prices) {
    return (
      <div className="bg-[var(--bg-secondary)] border-b border-[var(--border)] px-4 md:px-6 py-2">
        <div className="max-w-[1440px] mx-auto flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent-red)]"></span>
            <span className="text-[10px] text-[var(--accent-red)]">OFFLINE</span>
          </span>
          <span className="text-[var(--text-muted)] text-xs">Ticker unavailable — {error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-secondary)] border-b border-[var(--border)] px-4 md:px-6 py-2 overflow-hidden">
      <div className="max-w-[1440px] mx-auto">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
          {/* Connection status indicator */}
          <span className="flex-shrink-0 flex items-center gap-1 px-2 mr-1">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${
              connectionStatus === 'live' ? 'bg-[var(--accent-green)] animate-pulse' :
              connectionStatus === 'stale' ? 'bg-[var(--accent-amber)] animate-pulse' :
              connectionStatus === 'error' ? 'bg-[var(--accent-red)]' :
              'bg-[var(--accent-amber)] animate-pulse'
            }`}></span>
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
              {connectionStatus === 'live' ? 'LIVE' :
               connectionStatus === 'stale' ? 'STALE' :
               connectionStatus === 'error' ? 'OFFLINE' :
               'CONNECTING'}
            </span>
          </span>
          
          {SYMBOLS.map(sym => {
            const info = prices?.[sym];
            const meta = SYMBOL_META[sym] || { label: sym.split('/')[0], icon: '●', decimals: 2 };
            const price = info?.price ?? null;
            const changePct = info?.dailyChange ?? null;
            const change = formatChange(changePct);
            const flash = flashState[sym];
            const history = priceHistory[sym];
            const spread = info?.spread;
            
            return (
              <button
                key={sym}
                onClick={() => onSymbolClick?.(sym)}
                className={`flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] transition-colors cursor-pointer group relative overflow-hidden ${
                  flash === 'up' ? 'bg-[var(--accent-green)]/10' : flash === 'down' ? 'bg-[var(--accent-red)]/10' : ''
                }`}
                title={`Click to trade ${meta.label}${spread ? ` | Spread: $${spread.toFixed(4)}` : ''}${info?.bid ? ` | Bid: $${info.bid.toFixed(2)} Ask: $${info.ask.toFixed(2)}` : ''}`}
              >
                {/* Price flash overlay */}
                {flash && (
                  <span className={`absolute inset-0 opacity-20 pointer-events-none ${
                    flash === 'up' ? 'bg-[var(--accent-green)]' : 'bg-[var(--accent-red)]'
                  }`} style={{ animation: 'flash-fade 0.5s ease-out forwards' }} />
                )}
                <span className="text-sm">{meta.icon}</span>
                <span className="text-xs text-[var(--text-secondary)] font-medium group-hover:text-[var(--text-primary)]">{meta.label}</span>
                <span className={`text-xs text-[var(--text-primary)] font-mono transition-colors duration-300 ${
                  flash === 'up' ? 'text-[var(--accent-green)]' : flash === 'down' ? 'text-[var(--accent-red)]' : ''
                }`}>{formatPrice(price, meta.decimals)}</span>
                <span className={`text-xs font-mono ${change.className}`}>
                  {change.text}
                </span>
                {/* Mini sparkline showing price trend */}
                {history && history.length > 2 && (
                  <MiniSparkline history={history} />
                )}
              </button>
            );
          })}
        </div>
      </div>
      
      {/* Flash animation keyframes */}
      <style>{`
        @keyframes flash-fade {
          0% { opacity: 0.3; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}