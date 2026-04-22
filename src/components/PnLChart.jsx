import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

export default function PnLChart({ history }) {
  if (!history || !history.equity || history.equity.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-[#8b8fa3]">
        No portfolio history available yet
      </div>
    );
  }

  const data = history.equity.map((val, i) => ({
    date: new Date(history.timestamp[i] * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    equity: parseFloat(val),
  }));

  // Calculate baseline for coloring
  const baseline = data[0]?.equity || 0;

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const val = payload[0].value;
      const diff = val - baseline;
      const pctChange = baseline ? ((diff / baseline) * 100).toFixed(2) : 0;
      return (
        <div className="bg-[#252836] border border-[#2d3148] rounded-lg p-3 shadow-xl">
          <p className="text-xs text-[#8b8fa3]">{label}</p>
          <p className="text-sm font-bold text-white">${val.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
          <p className={`text-xs ${diff >= 0 ? 'text-[#00c853]' : 'text-[#ff1744]'}`}>
            {diff >= 0 ? '+' : ''}{diff.toLocaleString('en-US', { minimumFractionDigits: 2 })} ({diff >= 0 ? '+' : ''}{pctChange}%)
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <XAxis 
          dataKey="date" 
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#8b8fa3', fontSize: 11 }}
        />
        <YAxis
          domain={['auto', 'auto']}
          axisLine={false}
          tickLine={false}
          tick={{ fill: '#8b8fa3', fontSize: 11 }}
          tickFormatter={(v) => `$${(v/1000).toFixed(1)}k`}
        />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine y={baseline} stroke="#2d3148" strokeDasharray="3 3" />
        <Line
          type="monotone"
          dataKey="equity"
          stroke="#448aff"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: '#448aff', stroke: '#0f1117', strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}