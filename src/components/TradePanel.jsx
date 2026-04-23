import { useState, useEffect } from 'react';
import { useLivePrices } from '../hooks/useLivePrices';

const POPULAR_CRYPTOS = [
  { symbol: 'BTC/USD', label: 'Bitcoin', icon: '₿' },
  { symbol: 'ETH/USD', label: 'Ethereum', icon: 'Ξ' },
  { symbol: 'SOL/USD', label: 'Solana', icon: '◎' },
  { symbol: 'DOGE/USD', label: 'Dogecoin', icon: '🐕' },
  { symbol: 'ADA/USD', label: 'Cardano', icon: '♦' },
  { symbol: 'AVAX/USD', label: 'Avalanche', icon: '🔺' },
  { symbol: 'LINK/USD', label: 'Chainlink', icon: '⬡' },
  { symbol: 'MATIC/USD', label: 'Polygon', icon: '⬢' },
];

export default function TradePanel({ onTrade, positions, defaultSymbol, onSymbolSelected }) {
  const [symbol, setSymbol] = useState(defaultSymbol || 'BTC/USD');
  const [qty, setQty] = useState('0.001');
  const [side, setSide] = useState('buy');
  const [orderType, setOrderType] = useState('market');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);
  const { prices: livePrices, flashState } = useLivePrices(5000);

  // Get live price for the selected symbol
  const selectedPrice = livePrices?.[symbol]?.price;
  const selectedChange = livePrices?.[symbol]?.dailyChange;
  const selectedBid = livePrices?.[symbol]?.bid;
  const selectedAsk = livePrices?.[symbol]?.ask;

  useEffect(() => {
    if (defaultSymbol) {
      setSymbol(defaultSymbol);
      onSymbolSelected?.();
    }
  }, [defaultSymbol]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      await onTrade(symbol, qty, side, orderType);
      setMessage({ type: 'success', text: `${side.toUpperCase()} order placed for ${qty} ${symbol}` });
      setTimeout(() => setMessage(null), 4000);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const positionSymbols = new Set(positions?.map(p => p.symbol) || []);

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">Place Trade</h2>

      {message && (
        <div className={`px-4 py-3 rounded-lg text-sm ${
          message.type === 'success'
            ? 'bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/30'
            : 'bg-[var(--accent-red)]/10 text-[var(--accent-red)] border border-[var(--accent-red)]/30'
        }`}>
          {message.text}
        </div>
      )}

      {/* Quick select */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
        <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">Quick Select</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {POPULAR_CRYPTOS.map(crypto => {
            const priceInfo = livePrices?.[crypto.symbol];
            const price = priceInfo?.price;
            const change = priceInfo?.dailyChange;
            const flash = flashState[crypto.symbol];
            return (
              <button
                key={crypto.symbol}
                onClick={() => setSymbol(crypto.symbol)}
                className={`px-3 py-2 rounded-lg text-sm transition-all relative overflow-hidden ${
                  symbol === crypto.symbol
                    ? 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)] border border-[var(--accent-blue)]/50'
                    : positionSymbols.has(crypto.symbol)
                    ? 'bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--accent-green)]/30 hover:border-[var(--accent-blue)]/50'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border)] hover:border-[var(--accent-blue)]/50'
                } ${flash === 'up' ? 'bg-[var(--accent-green)]/10' : flash === 'down' ? 'bg-[var(--accent-red)]/10' : ''}`}
              >
                {flash && (
                  <span className={`absolute inset-0 opacity-15 pointer-events-none ${
                    flash === 'up' ? 'bg-[var(--accent-green)]' : 'bg-[var(--accent-red)]'
                  }`} style={{ animation: 'flash-fade 0.5s ease-out forwards' }} />
                )}
                <span className="block text-lg">{crypto.icon}</span>
                <span className="block text-xs mt-0.5">{crypto.label}</span>
                {price != null && (
                  <span className={`block text-[10px] font-mono ${
                    flash === 'up' ? 'text-[var(--accent-green)]' : flash === 'down' ? 'text-[var(--accent-red)]' : 'text-[var(--text-muted)]'
                  }`}>
                    ${price >= 1 ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : price.toFixed(6)}
                  </span>
                )}
                {change != null && (
                  <span className={`block text-[10px] font-mono ${change >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                    {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Trade Form */}
      <form onSubmit={handleSubmit} className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 space-y-4">
        {/* Symbol */}
        <div>
          <label className="block text-sm text-[var(--text-muted)] mb-1">Symbol</label>
          <input
            type="text"
            value={symbol}
            onChange={e => setSymbol(e.target.value)}
            className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm focus:border-[var(--accent-blue)] focus:outline-none"
            placeholder="e.g., BTC/USD"
          />
          {/* Live price info for selected symbol */}
          {selectedPrice != null && (
            <div className="flex items-center gap-3 mt-1.5 text-xs font-mono">
              <span className={`text-[var(--text-primary)] font-semibold ${
                flashState[symbol] === 'up' ? 'text-[var(--accent-green)]' : flashState[symbol] === 'down' ? 'text-[var(--accent-red)]' : ''
              }`}>
                ${selectedPrice >= 1 ? selectedPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : selectedPrice.toFixed(6)}
              </span>
              {selectedChange != null && (
                <span className={selectedChange >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}>
                  {selectedChange >= 0 ? '+' : ''}{selectedChange.toFixed(2)}%
                </span>
              )}
              {selectedBid > 0 && selectedAsk > 0 && (
                <span className="text-[var(--text-muted)]">
                  Bid: ${selectedBid.toFixed(2)} / Ask: ${selectedAsk.toFixed(2)}
                </span>
              )}
              <span className="flex items-center gap-1 text-[var(--accent-green)]">
                <span className="inline-block w-1 h-1 rounded-full bg-[var(--accent-green)] animate-pulse"></span>
                LIVE
              </span>
            </div>
          )}
        </div>

        {/* Quantity */}
        <div>
          <label className="block text-sm text-[var(--text-muted)] mb-1">Quantity</label>
          <input
            type="text"
            value={qty}
            onChange={e => setQty(e.target.value)}
            className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm focus:border-[var(--accent-blue)] focus:outline-none"
            placeholder="0.001"
          />
          {symbol === 'BTC/USD' && (
            <div className="flex gap-1 mt-1">
              {['0.0001', '0.001', '0.01', '0.1'].map(amt => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setQty(amt)}
                  className="px-2 py-0.5 text-xs bg-[var(--bg-secondary)] text-[var(--text-muted)] rounded hover:text-[var(--text-primary)] transition-colors"
                >
                  {amt}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Side */}
        <div>
          <label className="block text-sm text-[var(--text-muted)] mb-1">Side</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSide('buy')}
              className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                side === 'buy'
                  ? 'bg-[var(--accent-green)]/20 text-[var(--accent-green)] border border-[var(--accent-green)]/50'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border)]'
              }`}
            >
              ▲ BUY
            </button>
            <button
              type="button"
              onClick={() => setSide('sell')}
              className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                side === 'sell'
                  ? 'bg-[var(--accent-red)]/20 text-[var(--accent-red)] border border-[var(--accent-red)]/50'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border)]'
              }`}
            >
              ▼ SELL
            </button>
          </div>
        </div>

        {/* Order Type */}
        <div>
          <label className="block text-sm text-[var(--text-muted)] mb-1">Order Type</label>
          <div className="flex gap-2">
            {['market', 'limit'].map(type => (
              <button
                key={type}
                type="button"
                onClick={() => setOrderType(type)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  orderType === type
                    ? 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)] border border-[var(--accent-blue)]/50'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border)]'
                }`}
              >
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className={`w-full py-3 rounded-lg font-semibold transition-colors disabled:opacity-50 ${
            side === 'buy'
              ? 'bg-[var(--accent-green)] text-white hover:bg-[var(--accent-green)]/80'
              : 'bg-[var(--accent-red)] text-white hover:bg-[var(--accent-red)]/80'
          }`}
        >
          {submitting ? 'Placing Order...' : `${side === 'buy' ? '📈 BUY' : '📉 SELL'} ${symbol}`}
        </button>
      </form>

      {/* Current positions in this symbol */}
      {positionSymbols.has(symbol) && positions && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <h3 className="text-sm font-medium text-[var(--text-muted)] mb-2">Current Position in {symbol}</h3>
          {positions.filter(p => p.symbol === symbol).map((pos, i) => (
            <div key={i} className="flex justify-between items-center py-1">
              <span className="text-[var(--text-primary)]">{parseFloat(pos.qty).toFixed(6)} {pos.symbol}</span>
              <span className={`text-sm ${parseFloat(pos.unrealized_pl) >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
                {parseFloat(pos.unrealized_pl) >= 0 ? '+' : ''}${parseFloat(pos.unrealized_pl).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
      
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