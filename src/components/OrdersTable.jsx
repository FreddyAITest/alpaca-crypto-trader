export default function OrdersTable({ orders, onCancel }) {
  if (!orders || orders.length === 0) {
    return (
      <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] p-8 text-center">
        <div className="text-3xl mb-2">✅</div>
        <p className="text-[#8b8fa3]">No open orders</p>
      </div>
    );
  }

  const formatMoney = (val) => {
    if (val === null || val === undefined) return '$—';
    const num = typeof val === 'string' ? parseFloat(val) : val;
    return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const statusColors = {
    new: 'bg-[#448aff]/20 text-[#448aff]',
    partially_filled: 'bg-[#ff9100]/20 text-[#ff9100]',
    filled: 'bg-[#00c853]/20 text-[#00c853]',
    canceled: 'bg-[#8b8fa3]/20 text-[#8b8fa3]',
    rejected: 'bg-[#ff1744]/20 text-[#ff1744]',
  };

  return (
    <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#2d3148]">
              <th className="px-4 py-3 text-left text-[#8b8fa3] font-medium">Time</th>
              <th className="px-4 py-3 text-left text-[#8b8fa3] font-medium">Symbol</th>
              <th className="px-4 py-3 text-left text-[#8b8fa3] font-medium">Side</th>
              <th className="px-4 py-3 text-left text-[#8b8fa3] font-medium">Type</th>
              <th className="px-4 py-3 text-right text-[#8b8fa3] font-medium">Qty</th>
              <th className="px-4 py-3 text-right text-[#8b8fa3] font-medium">Limit Price</th>
              <th className="px-4 py-3 text-center text-[#8b8fa3] font-medium">Status</th>
              <th className="px-4 py-3 text-center text-[#8b8fa3] font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order, i) => (
              <tr key={order.id || i} className="border-b border-[#2d3148]/50 hover:bg-[#252836] transition-colors">
                <td className="px-4 py-3 text-[#8b8fa3] text-xs">
                  {order.submitted_at ? new Date(order.submitted_at).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3 font-medium text-white">{order.symbol}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    order.side === 'buy' ? 'bg-[#00c853]/20 text-[#00c853]' : 'bg-[#ff1744]/20 text-[#ff1744]'
                  }`}>
                    {order.side.toUpperCase()}
                  </span>
                </td>
                <td className="px-4 py-3 text-[#8b8fa3]">{order.type}</td>
                <td className="px-4 py-3 text-right text-[#e4e7f1]">{parseFloat(order.qty).toFixed(6)}</td>
                <td className="px-4 py-3 text-right text-[#e4e7f1]">
                  {order.limit_price ? formatMoney(order.limit_price) : 'Market'}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[order.status] || 'bg-[#8b8fa3]/20 text-[#8b8fa3]'}`}>
                    {order.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  {onCancel && (order.status === 'new' || order.status === 'partially_filled') && (
                    <button
                      onClick={() => onCancel(order.id)}
                      className="text-xs px-2 py-1 bg-[#ff1744]/10 text-[#ff1744] hover:bg-[#ff1744]/20 rounded transition-colors"
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