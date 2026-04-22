export default function AccountCard({ title, value, valueClass = 'text-white', subtitle, icon }) {
  return (
    <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] p-4 hover:border-[#448aff]/30 transition-colors">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-[#8b8fa3] mb-1">{title}</p>
          <p className={`text-2xl font-bold ${valueClass}`}>{value}</p>
          {subtitle && <p className="text-xs text-[#8b8fa3] mt-1">{subtitle}</p>}
        </div>
        <span className="text-2xl">{icon}</span>
      </div>
    </div>
  );
}