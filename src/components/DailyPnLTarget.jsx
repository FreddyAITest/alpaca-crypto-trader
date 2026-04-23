import { useState, useEffect } from 'react';
import { fetchAccount, fetchBotStatus } from '../api';

export default function DailyPnLTarget() {
  const [loading, setLoading] = useState(true);
  const [dailyPnlPct, setDailyPnlPct] = useState(0);
  const [dailyPnl, setDailyPnl] = useState(0);
  const [equity, setEquity] = useState(0);
  const [botStatus, setBotStatus] = useState(null);
  const [targetPct, setTargetPct] = useState(8); // 8% upper target
  const [lossLimitPct, setLossLimitPct] = useState(3); // 3% loss limit

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [accRes, botRes] = await Promise.allSettled([
          fetchAccount(),
          fetchBotStatus(),
        ]);

        if (cancelled) return;

        const acc = accRes.status === 'fulfilled' ? accRes.value : null;
        const bot = botRes.status === 'fulfilled' ? botRes.value : null;

        if (acc) {
          const eq = parseFloat(acc.equity || 0);
          const lastMkt = parseFloat(acc.last_mkt_value || eq);
          const pnl = eq - lastMkt;
          const pnlPct = lastMkt > 0 ? (pnl / lastMkt) * 100 : 0;
          setEquity(eq);
          setDailyPnl(pnl);
          setDailyPnlPct(pnlPct);
        }

        if (bot) {
          setBotStatus(bot);
          const risk = bot.risk || {};
          if (risk.profitTargetPct) setTargetPct(risk.profitTargetPct * 100);
          if (risk.lossLimitPct) setLossLimitPct(risk.lossLimitPct * 100);
        }
      } catch (e) {
        // Silent fail
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, 20000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (loading) {
    return (
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 animate-pulse">
        <div className="h-4 bg-[var(--bg-secondary)] rounded w-40 mb-3" />
        <div className="h-6 bg-[var(--bg-secondary)] rounded" />
      </div>
    );
  }

  // Progress bar: map dailyPnlPct from [-lossLimitPct, +targetPct] to [0%, 100%]
  // Center = 50% (0% P&L)
  const range = targetPct + lossLimitPct;
  const progress = Math.max(0, Math.min(100, ((dailyPnlPct + lossLimitPct) / range) * 100));
  const isPositive = dailyPnlPct >= 0;
  const isTargetHit = dailyPnlPct >= targetPct;
  const isLossLimit = dailyPnlPct <= -lossLimitPct;

  // Bar color
  let barColor = 'var(--accent-green)';
  let barBg = 'bg-[var(--accent-green)]';
  if (isLossLimit) {
    barColor = 'var(--accent-red)';
    barBg = 'bg-[var(--accent-red)]';
  } else if (dailyPnlPct < 0) {
    barColor = 'var(--accent-red)';
    barBg = 'bg-[var(--accent-red)]';
  } else if (isTargetHit) {
    barColor = 'var(--accent-green)';
    barBg = 'bg-[var(--accent-green)]';
  }

  // Status label
  const statusLabel = isLossLimit ? 'LOSS LIMIT REACHED'
    : isTargetHit ? 'TARGET HIT!'
    : dailyPnlPct >= targetPct * 0.75 ? 'NEAR TARGET'
    : dailyPnlPct >= 0 ? 'ON TRACK'
    : 'UNDER WATER';

  const statusColor = isLossLimit ? 'text-[var(--accent-red)]'
    : isTargetHit ? 'text-[var(--accent-green)]'
    : dailyPnlPct >= 0 ? 'text-[var(--accent-green)]'
    : 'text-[var(--accent-red)]';

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-[var(--text-muted)]">🎯 Daily P&L Target</h3>
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${
          isLossLimit ? 'bg-[var(--accent-red)]/20 text-[var(--accent-red)]' :
          isTargetHit ? 'bg-[var(--accent-green)]/20 text-[var(--accent-green)]' :
          'bg-[var(--bg-secondary)] text-[var(--text-muted)]'
        }`}>
          {statusLabel}
        </span>
      </div>

      {/* Current P&L display */}
      <div className="flex items-baseline gap-2 mb-2">
        <span className={`text-2xl font-bold ${statusColor}`}>
          {dailyPnlPct >= 0 ? '+' : ''}{dailyPnlPct.toFixed(2)}%
        </span>
        <span className="text-sm text-[var(--text-muted)]">
          ({dailyPnl >= 0 ? '+' : ''}${dailyPnl.toFixed(2)})
        </span>
      </div>

      {/* Progress bar */}
      <div className="relative">
        {/* Background track */}
        <div className="w-full h-4 bg-[var(--bg-secondary)] rounded-full overflow-hidden relative">
          {/* Loss zone (left third) */}
          <div className="absolute inset-y-0 left-0 w-[33%] bg-[var(--accent-red)]/5" />
          {/* Profit zone (right two thirds) */}
          <div className="absolute inset-y-0 right-0 w-[67%] bg-[var(--accent-green)]/5" />

          {/* Center line (0% P&L) */}
          <div className="absolute inset-y-0 left-[33%] w-px bg-[var(--text-muted)] opacity-30" />

          {/* Target line */}
          <div className="absolute inset-y-0 right-0 w-px bg-[var(--accent-green)] opacity-50" style={{ left: `${(1 - targetPct / range) * 100 + (1 - (1 - targetPct / range)) * (targetPct / range) * 100 / (targetPct / range)}%` }} />

          {/* Fill bar */}
          <div
            className={`h-full rounded-full transition-all duration-500 ${barBg} ${isTargetHit ? 'animate-pulse' : ''}`}
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Scale labels */}
        <div className="flex justify-between mt-1 text-[10px] text-[var(--text-muted)]">
          <span className="text-[var(--accent-red)]">-{lossLimitPct}%</span>
          <span>0%</span>
          <span className="text-[var(--accent-green)]">+{targetPct}%</span>
        </div>
      </div>

      {/* Target details */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div className="text-center">
          <div className="text-[var(--text-muted)]">Target</div>
          <div className="text-[var(--accent-green)] font-medium">+{targetPct}%</div>
          <div className="text-[var(--text-muted)]">
            ${equity > 0 ? ((equity * targetPct) / 100).toFixed(0) : '--'}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[var(--text-muted)]">Current</div>
          <div className={`font-bold ${statusColor}`}>{dailyPnlPct >= 0 ? '+' : ''}{dailyPnlPct.toFixed(1)}%</div>
          <div className="text-[var(--text-muted)]">${Math.abs(dailyPnl).toFixed(0)}</div>
        </div>
        <div className="text-center">
          <div className="text-[var(--text-muted)]">Limit</div>
          <div className="text-[var(--accent-red)] font-medium">-{lossLimitPct}%</div>
          <div className="text-[var(--text-muted)]">
            ${equity > 0 ? ((equity * lossLimitPct) / 100).toFixed(0) : '--'}
          </div>
        </div>
      </div>
    </div>
  );
}