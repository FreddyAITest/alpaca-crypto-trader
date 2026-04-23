import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchLivePrices } from '../api';

const SYMBOL_META = {
  'BTC/USD': { label: 'BTC', icon: '₿' },
  'ETH/USD': { label: 'ETH', icon: 'Ξ' },
  'SOL/USD': { label: 'SOL', icon: '◎' },
  'DOGE/USD': { label: 'DOGE', icon: '🐕' },
  'ADA/USD': { label: 'ADA', icon: '♦' },
  'AVAX/USD': { label: 'AVAX', icon: '🔺' },
  'LINK/USD': { label: 'LINK', icon: '⬡' },
  'MATIC/USD': { label: 'MATIC', icon: '⬢' },
};

const SYMBOLS = Object.keys(SYMBOL_META);

function formatPrice(price) {
  if (price == null) return '—';
  const num = typeof price === 'string' ? parseFloat(price) : price;
  if (num >= 1000) return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (num >= 1) return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return '$' + num.toFixed(6);
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

export default function CryptoTicker({ onSymbolClick }) {
  const [prices, setPrices] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const prevPricesRef = useRef({});
  const [flashState, setFlashState] = useState({});

  const refresh = useCallback(async () => {
    try {
      setError(null);
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
        setTimeout(() => setFlashState({}), 600);
      }
      
      // Store previous prices for comparison
      const prevMap = {};
      for (const [symbol, info] of Object.entries(newPrices)) {
        prevMap[symbol] = info.price;
      }
      prevPricesRef.current = prevMap;
      
      setPrices(newPrices);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Poll every 8 seconds for near-real-time updates
    const interval = setInterval(refresh, 8000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Connection status indicator
  const [isStale, setIsStale] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => {
      // If prices are more than 20 seconds old, show stale indicator
      setIsStale(prices ? (Date.now() - 20000) > 0 : false);
    }, 5000);
    return () => clearInterval(timer);
  }, [prices]);

  if (loading && !prices) {
    return (
      <div className="bg-[var(--bg-secondary)] border-b border-[var(--border)] px-4 md:px-6 py-2">
        <div className="max-w-[1440px] mx-auto flex items-center gap-4 overflow-x-auto scrollbar-hide">
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
        <div className="max-w-[1440px] mx-auto text-[var(--text-muted)] text-xs">
          Ticker unavailable — {error}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-secondary)] border-b border-[var(--border)] px-4 md:px-6 py-2 overflow-hidden">
      <div className="max-w-[1440px] mx-auto">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
          {/* Live indicator */}
          <span className="flex-shrink-0 flex items-center gap-1 px-2 mr-1">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${isStale ? 'bg-[var(--accent-amber)]' : 'bg-[var(--accent-green)]'} animate-pulse`}></span>
            <span className="text-[10px] text-[var(--text-muted)]">LIVE</span>
          </span>
          
          {SYMBOLS.map(sym => {
            const info = prices?.[sym];
            const meta = SYMBOL_META[sym] || { label: sym.split('/')[0], icon: '●' };
            const price = info?.price ?? null;
            const changePct = info?.dailyChange ?? null;
            const change = formatChange(changePct);
            const flash = flashState[sym];
            const spread = info?.spread;
            
            return (
              <button
                key={sym}
                onClick={() => onSymbolClick?.(sym)}
                className={`flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] transition-colors cursor-pointer group relative overflow-hidden ${
                  flash === 'up' ? 'bg-[var(--accent-green)]/10' : flash === 'down' ? 'bg-[var(--accent-red)]/10' : ''
                }`}
                title={`Click to trade ${meta.label}${spread ? ` | Spread: $${spread.toFixed(4)}` : ''}`}
              >
                {/* Price flash overlay */}
                {flash && (
                  <span className={`absolute inset-0 opacity-20 pointer-events-none ${
                    flash === 'up' ? 'bg-[var(--accent-green)]' : 'bg-[var(--accent-red)]'
                  }`} style={{ animation: 'flash-fade 0.6s ease-out forwards' }} />
                )}
                <span className="text-sm">{meta.icon}</span>
                <span className="text-xs text-[var(--text-secondary)] font-medium group-hover:text-[var(--text-primary)]">{meta.label}</span>
                <span className={`text-xs text-[var(--text-primary)] font-mono transition-colors duration-300 ${
                  flash === 'up' ? 'text-[var(--accent-green)]' : flash === 'down' ? 'text-[var(--accent-red)]' : ''
                }`}>{formatPrice(price)}</span>
                <span className={`text-xs font-mono ${change.className}`}>
                  {change.text}
                </span>
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