import { useState } from 'react';

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

export default function TradePanel({ onTrade, positions }) {
  const [symbol, setSymbol] = useState('BTC/USD');
  const [qty, setQty] = useState('0.001');
  const [side, setSide] = useState('buy');
  const [orderType, setOrderType] = useState('market');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

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
    <div className="max-w-lg mx-auto space-y-6">
      <h2 className="text-lg font-semibold text-white">Place Trade</h2>

      {message && (
        <div className={`px-4 py-3 rounded-lg text-sm ${
          message.type === 'success' 
            ? 'bg-[#00c853]/10 text-[#00c853] border border-[#00c853]/30' 
            : 'bg-[#ff1744]/10 text-[#ff1744] border border-[#ff1744]/30'
        }`}>
          {message.text}
        </div>
      )}

      {/* Quick select */}
      <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] p-4">
        <h3 className="text-sm font-medium text-[#8b8fa3] mb-3">Quick Select</h3>
        <div className="grid grid-cols-4 gap-2">
          {POPULAR_CRYPTOS.map(crypto => (
            <button
              key={crypto.symbol}
              onClick={() => setSymbol(crypto.symbol)}
              className={`px-3 py-2 rounded-lg text-sm transition-all ${
                symbol === crypto.symbol
                  ? 'bg-[#448aff]/20 text-[#448aff] border border-[#448aff]/50'
                  : positionSymbols.has(crypto.symbol)
                  ? 'bg-[#1a1d29] text-[#e4e7f1] border border-[#00c853]/30 hover:border-[#448aff]/50'
                  : 'bg-[#252836] text-[#e4e7f1] border border-[#2d3148] hover:border-[#448aff]/50'
              }`}
            >
              <span className="block text-lg">{crypto.icon}</span>
              <span className="block text-xs mt-0.5">{crypto.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Trade Form */}
      <form onSubmit={handleSubmit} className="bg-[#1a1d29] rounded-xl border border-[#2d3148] p-4 space-y-4">
        {/* Symbol */}
        <div>
          <label className="block text-sm text-[#8b8fa3] mb-1">Symbol</label>
          <input
            type="text"
            value={symbol}
            onChange={e => setSymbol(e.target.value)}
            className="w-full bg-[#0f1117] border border-[#2d3148] rounded-lg px-3 py-2 text-white text-sm focus:border-[#448aff] focus:outline-none"
            placeholder="e.g., BTC/USD"
          />
        </div>

        {/* Quantity */}
        <div>
          <label className="block text-sm text-[#8b8fa3] mb-1">Quantity</label>
          <input
            type="text"
            value={qty}
            onChange={e => setQty(e.target.value)}
            className="w-full bg-[#0f1117] border border-[#2d3148] rounded-lg px-3 py-2 text-white text-sm focus:border-[#448aff] focus:outline-none"
            placeholder="0.001"
          />
          {symbol === 'BTC/USD' && (
            <div className="flex gap-1 mt-1">
              {['0.0001', '0.001', '0.01', '0.1'].map(amt => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setQty(amt)}
                  className="px-2 py-0.5 text-xs bg-[#252836] text-[#8b8fa3] rounded hover:text-white transition-colors"
                >
                  {amt}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Side */}
        <div>
          <label className="block text-sm text-[#8b8fa3] mb-1">Side</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSide('buy')}
              className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                side === 'buy'
                  ? 'bg-[#00c853]/20 text-[#00c853] border border-[#00c853]/50'
                  : 'bg-[#252836] text-[#8b8fa3] border border-[#2d3148]'
              }`}
            >
              ▲ BUY
            </button>
            <button
              type="button"
              onClick={() => setSide('sell')}
              className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                side === 'sell'
                  ? 'bg-[#ff1744]/20 text-[#ff1744] border border-[#ff1744]/50'
                  : 'bg-[#252836] text-[#8b8fa3] border border-[#2d3148]'
              }`}
            >
              ▼ SELL
            </button>
          </div>
        </div>

        {/* Order Type */}
        <div>
          <label className="block text-sm text-[#8b8fa3] mb-1">Order Type</label>
          <div className="flex gap-2">
            {['market', 'limit'].map(type => (
              <button
                key={type}
                type="button"
                onClick={() => setOrderType(type)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  orderType === type
                    ? 'bg-[#448aff]/20 text-[#448aff] border border-[#448aff]/50'
                    : 'bg-[#252836] text-[#8b8fa3] border border-[#2d3148]'
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
              ? 'bg-[#00c853] text-black hover:bg-[#00c853]/80'
              : 'bg-[#ff1744] text-white hover:bg-[#ff1744]/80'
          }`}
        >
          {submitting ? 'Placing Order...' : `${side === 'buy' ? '📈 BUY' : '📉 SELL'} ${symbol}`}
        </button>
      </form>

      {/* Current positions in this symbol */}
      {positionSymbols.has(symbol) && positions && (
        <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] p-4">
          <h3 className="text-sm font-medium text-[#8b8fa3] mb-2">Current Position in {symbol}</h3>
          {positions.filter(p => p.symbol === symbol).map((pos, i) => (
            <div key={i} className="flex justify-between items-center py-1">
              <span className="text-white">{parseFloat(pos.qty).toFixed(6)} {pos.symbol}</span>
              <span className={`text-sm ${parseFloat(pos.unrealized_pl) >= 0 ? 'text-[#00c853]' : 'text-[#ff1744]'}`}>
                {parseFloat(pos.unrealized_pl) >= 0 ? '+' : ''}${parseFloat(pos.unrealized_pl).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}