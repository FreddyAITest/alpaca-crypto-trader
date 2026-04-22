export default function ActivityLog({ activities }) {
  if (!activities || activities.length === 0) {
    return (
      <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] p-4 text-center">
        <p className="text-[#8b8fa3] text-sm">No recent activity</p>
      </div>
    );
  }

  return (
    <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] p-4 space-y-3 max-h-[400px] overflow-y-auto">
      {activities.slice(0, 20).map((activity, i) => {
        const isBuy = activity.side === 'buy';
        return (
          <div key={i} className="flex items-center gap-3 text-sm">
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
              isBuy ? 'bg-[#00c853]/20 text-[#00c853]' : 'bg-[#ff1744]/20 text-[#ff1744]'
            }`}>
              {isBuy ? 'BUY' : 'SELL'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between">
                <span className="text-white font-medium truncate">{activity.symbol}</span>
                <span className="text-[#8b8fa3] text-xs ml-2">
                  {activity.timestamp ? new Date(activity.timestamp).toLocaleDateString() : ''}
                </span>
              </div>
              <div className="text-[#8b8fa3] text-xs">
                {parseFloat(activity.qty || 0).toFixed(6)} @ ${(parseFloat(activity.price || 0)).toFixed(2)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}