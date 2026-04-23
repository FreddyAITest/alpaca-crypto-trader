import { useState, useEffect, useCallback } from 'react';
import { fetchCryptoSnapshots } from '../api';

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
  const [snapshots, setSnapshots] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchCryptoSnapshots(SYMBOLS.join(','));
      // API returns { snapshots: { "BTC/USD": { latestTrade: {...}, dailyBar: {...}, ... }, ... } }
      // or flat { "BTC/USD": { ... } } depending on response structure
      const snapshotMap = data.snapshots || data;
      setSnapshots(snapshotMap);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (loading && !snapshots) {
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

  if (error && !snapshots) {
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
          {SYMBOLS.map(sym => {
            const snap = snapshots?.[sym];
            const meta = SYMBOL_META[sym] || { label: sym.split('/')[0], icon: '●' };
            // Alpaca snapshot structure: latestTrade.p for price, dailyBar for change
            const price = snap?.latestTrade?.p ?? snap?.dailyBar?.c ?? null;
            const prevClose = snap?.prevDailyBar?.c ?? null;
            const changePct = (price != null && prevClose != null && prevClose > 0)
              ? ((price - prevClose) / prevClose) * 100
              : snap?.dailyBar?.c != null && snap?.dailyBar?.o != null && snap?.dailyBar?.o > 0
                ? ((snap.dailyBar.c - snap.dailyBar.o) / snap.dailyBar.o) * 100
                : null;
            const change = formatChange(changePct);

            return (
              <button
                key={sym}
                onClick={() => onSymbolClick?.(sym)}
                className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] transition-colors cursor-pointer group"
                title={`Click to trade ${meta.label}`}
              >
                <span className="text-sm">{meta.icon}</span>
                <span className="text-xs text-[var(--text-secondary)] font-medium group-hover:text-[var(--text-primary)]">{meta.label}</span>
                <span className="text-xs text-[var(--text-primary)] font-mono">{formatPrice(price)}</span>
                <span className={`text-xs font-mono ${change.className}`}>
                  {change.text}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}