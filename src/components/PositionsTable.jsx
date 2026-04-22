export default function PositionsTable({ positions, detailed }) {
  const formatMoney = (val) => {
    if (val === null || val === undefined) return '$—';
    const num = typeof val === 'string' ? parseFloat(val) : val;
    return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const pnlColor = (val) => {
    const num = typeof val === 'string' ? parseFloat(val) : val;
    return num >= 0 ? 'text-[#00c853]' : 'text-[#ff1744]';
  };

  if (!positions || positions.length === 0) {
    return (
      <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] p-8 text-center">
        <div className="text-3xl mb-2">📭</div>
        <p className="text-[#8b8fa3]">No open positions</p>
        <p className="text-xs text-[#8b8fa3] mt-1">Go to Trade tab to place an order</p>
      </div>
    );
  }

  return (
    <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#2d3148]">
              <th className="px-4 py-3 text-left text-[#8b8fa3] font-medium">Symbol</th>
              <th className="px-4 py-3 text-right text-[#8b8fa3] font-medium">Qty</th>
              <th className="px-4 py-3 text-right text-[#8b8fa3] font-medium">Avg Price</th>
              <th className="px-4 py-3 text-right text-[#8b8fa3] font-medium">Current</th>
              <th className="px-4 py-3 text-right text-[#8b8fa3] font-medium">Market Value</th>
              <th className="px-4 py-3 text-right text-[#8b8fa3] font-medium">P&L</th>
              {detailed && <th className="px-4 py-3 text-right text-[#8b8fa3] font-medium">P&L %</th>}
              {detailed && <th className="px-4 py-3 text-right text-[#8b8fa3] font-medium">Side</th>}
            </tr>
          </thead>
          <tbody>
            {positions.map((pos, i) => {
              const pnl = parseFloat(pos.unrealized_pl || 0);
              const pnlPct = parseFloat(pos.unrealized_plpc || 0) * 100;
              return (
                <tr key={pos.asset_id || i} className="border-b border-[#2d3148]/50 hover:bg-[#252836] transition-colors">
                  <td className="px-4 py-3 font-medium text-white">
                    <span className="flex items-center gap-2">
                      {pos.side === 'long' ? '🟢' : '🔴'}
                      {pos.symbol}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-[#e4e7f1]">{parseFloat(pos.qty).toFixed(6)}</td>
                  <td className="px-4 py-3 text-right text-[#e4e7f1]">{formatMoney(pos.avg_entry_price)}</td>
                  <td className="px-4 py-3 text-right text-[#e4e7f1]">{formatMoney(pos.current_price)}</td>
                  <td className="px-4 py-3 text-right text-[#e4e7f1]">{formatMoney(pos.market_value)}</td>
                  <td className={`px-4 py-3 text-right font-medium ${pnlColor(pnl)}`}>
                    {pnl >= 0 ? '+' : ''}{formatMoney(pnl)}
                  </td>
                  {detailed && (
                    <td className={`px-4 py-3 text-right font-medium ${pnlColor(pnl)}`}>
                      {pnl >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                    </td>
                  )}
                  {detailed && (
                    <td className="px-4 py-3 text-right">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        pos.side === 'long' 
                          ? 'bg-[#00c853]/20 text-[#00c853]' 
                          : 'bg-[#ff1744]/20 text-[#ff1744]'
                      }`}>
                        {pos.side.toUpperCase()}
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}