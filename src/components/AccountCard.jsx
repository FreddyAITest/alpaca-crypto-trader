export default function AccountCard({ title, value, valueClass = 'text-[var(--text-primary)]', subtitle, icon }) {
  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 hover:border-[var(--accent-blue)]/30 transition-colors">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-[var(--text-muted)] mb-1">{title}</p>
          <p className={`text-2xl font-bold ${valueClass}`}>{value}</p>
          {subtitle && <p className="text-xs text-[var(--text-muted)] mt-1">{subtitle}</p>}
        </div>
        <span className="text-2xl">{icon}</span>
      </div>
    </div>
  );
}