export default function PositionsTable({ positions, detailed }) {
  const formatMoney = (val) => {
    if (val === null || val === undefined) return '$—';
    const num = typeof val === 'string' ? parseFloat(val) : val;
    return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const pnlColor = (val) => {
    const num = typeof val === 'string' ? parseFloat(val) : val;
    return num >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]';
  };

  if (!positions || positions.length === 0) {
    return (
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-8 text-center">
        <div className="text-3xl mb-2">📭</div>
        <p className="text-[var(--text-muted)]">No open positions</p>
        <p className="text-xs text-[var(--text-muted)] mt-1">Go to Trade tab to place an order</p>
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-hidden">
      <div className="overflow-x-auto -mx-4 md:mx-0">
        <table className="w-full text-sm min-w-[600px] md:min-w-0">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="px-4 py-3 text-left text-[var(--text-muted)] font-medium sticky left-0 md:static bg-[var(--bg-secondary)] md:bg-transparent z-10">Symbol</th>
              <th className="px-4 py-3 text-right text-[var(--text-muted)] font-medium">Qty</th>
              <th className="px-4 py-3 text-right text-[var(--text-muted)] font-medium">Avg Price</th>
              <th className="px-4 py-3 text-right text-[var(--text-muted)] font-medium">Current</th>
              <th className="px-4 py-3 text-right text-[var(--text-muted)] font-medium whitespace-nowrap">Market Value</th>
              <th className="px-4 py-3 text-right text-[var(--text-muted)] font-medium">P&L</th>
              {detailed && <th className="px-4 py-3 text-right text-[var(--text-muted)] font-medium">P&L %</th>}
              {detailed && <th className="px-4 py-3 text-right text-[var(--text-muted)] font-medium">Side</th>}
            </tr>
          </thead>
          <tbody>
            {positions.map((pos, i) => {
              const pnl = parseFloat(pos.unrealized_pl || 0);
              const pnlPct = parseFloat(pos.unrealized_plpc || 0) * 100;
              return (
                <tr key={pos.asset_id || i} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-card-hover)] transition-colors">
                  <td className="px-4 py-3 font-medium text-[var(--text-primary)] sticky left-0 md:static bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] z-10 md:bg-transparent">
                    <span className="flex items-center gap-2">
                      {pos.side === 'long' ? '🟢' : '🔴'}
                      {pos.symbol}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{parseFloat(pos.qty).toFixed(6)}</td>
                  <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{formatMoney(pos.avg_entry_price)}</td>
                  <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{formatMoney(pos.current_price)}</td>
                  <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{formatMoney(pos.market_value)}</td>
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
                          ? 'bg-[var(--accent-green-dim)] text-[var(--accent-green)]'
                          : 'bg-[var(--accent-red-dim)] text-[var(--accent-red)]'
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