export default function OrdersTable({ orders, onCancel }) {
  if (!orders || orders.length === 0) {
    return (
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-8 text-center">
        <div className="text-3xl mb-2">✅</div>
        <p className="text-[var(--text-muted)]">No open orders</p>
      </div>
    );
  }

  const formatMoney = (val) => {
    if (val === null || val === undefined) return '$—';
    const num = typeof val === 'string' ? parseFloat(val) : val;
    return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const statusColors = {
    new: 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)]',
    partially_filled: 'bg-[var(--accent-yellow)]/20 text-[var(--accent-yellow)]',
    filled: 'bg-[var(--accent-green)]/20 text-[var(--accent-green)]',
    canceled: 'bg-[var(--text-muted)]/20 text-[var(--text-muted)]',
    rejected: 'bg-[var(--accent-red)]/20 text-[var(--accent-red)]',
  };

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-hidden">
      <div className="overflow-x-auto -mx-4 md:mx-0">
        <table className="w-full text-sm min-w-[700px] md:min-w-0">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="px-4 py-3 text-left text-[var(--text-muted)] font-medium sticky left-0 md:static bg-[var(--bg-secondary)] md:bg-transparent z-10">Time</th>
              <th className="px-4 py-3 text-left text-[var(--text-muted)] font-medium">Symbol</th>
              <th className="px-4 py-3 text-left text-[var(--text-muted)] font-medium">Side</th>
              <th className="px-4 py-3 text-left text-[var(--text-muted)] font-medium">Type</th>
              <th className="px-4 py-3 text-right text-[var(--text-muted)] font-medium">Qty</th>
              <th className="px-4 py-3 text-right text-[var(--text-muted)] font-medium">Limit Price</th>
              <th className="px-4 py-3 text-center text-[var(--text-muted)] font-medium">Status</th>
              <th className="px-4 py-3 text-center text-[var(--text-muted)] font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order, i) => (
              <tr key={order.id || i} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-card-hover)] transition-colors">
                <td className="px-4 py-3 text-[var(--text-muted)] text-xs sticky left-0 md:static bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)] z-10 md:bg-transparent">
                  {order.submitted_at ? new Date(order.submitted_at).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3 font-medium text-[var(--text-primary)]">{order.symbol}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    order.side === 'buy' ? 'bg-[var(--accent-green-dim)] text-[var(--accent-green)]' : 'bg-[var(--accent-red-dim)] text-[var(--accent-red)]'
                  }`}>
                    {order.side.toUpperCase()}
                  </span>
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)]">{order.type}</td>
                <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{parseFloat(order.qty).toFixed(6)}</td>
                <td className="px-4 py-3 text-right text-[var(--text-secondary)]">
                  {order.limit_price ? formatMoney(order.limit_price) : 'Market'}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[order.status] || 'bg-[var(--text-muted)]/20 text-[var(--text-muted)]'}`}>
                    {order.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  {onCancel && (order.status === 'new' || order.status === 'partially_filled') && (
                    <button
                      onClick={() => onCancel(order.id)}
                      className="text-xs px-2 py-1 bg-[var(--accent-red)]/10 text-[var(--accent-red)] hover:bg-[var(--accent-red)]/20 rounded transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}