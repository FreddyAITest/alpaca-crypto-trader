import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchBotStatus, fetchPositions, fetchAccount } from '../api';

// Alert types and their visual config
const ALERT_TYPES = {
  position_opened:   { icon: '📈', color: 'green',  label: 'Position Opened' },
  position_closed:   { icon: '🔒', color: 'green',  label: 'Position Closed' },
  stop_loss_hit:     { icon: '🛑', color: 'red',    label: 'Stop-Loss Hit' },
  take_profit_hit:   { icon: '🎯', color: 'green',  label: 'Take-Profit Hit' },
  strong_signal:     { icon: '⚡', color: 'amber',   label: 'Strong Signal' },
  risk_warning:      { icon: '⚠️', color: 'red',    label: 'Risk Warning' },
  bot_started:       { icon: '🟢', color: 'blue',   label: 'Bot Started' },
  bot_stopped:       { icon: '🔴', color: 'red',    label: 'Bot Stopped' },
  daily_target:      { icon: '🏆', color: 'green',  label: 'Daily Target Hit' },
  daily_loss_limit:  { icon: '💀', color: 'red',    label: 'Daily Loss Limit' },
};

let alertIdCounter = 0;

export default function TradeAlerts() {
  const [alerts, setAlerts] = useState([]);
  const [prevPositions, setPrevPositions] = useState([]);
  const [prevDailyPnl, setPrevDailyPnl] = useState(null);
  const initialized = useRef(false);
  const alertContainerRef = useRef(null);

  // Add an alert with auto-dismiss
  const addAlert = useCallback((type, message, details = {}) => {
    const id = ++alertIdCounter;
    const alertConfig = ALERT_TYPES[type] || ALERT_TYPES.risk_warning;

    setAlerts(prev => {
      // Max 8 alerts visible
      const updated = [...prev, { id, type, message, details, config: alertConfig, time: new Date() }];
      return updated.slice(-8);
    });

    // Auto-dismiss after 12 seconds
    setTimeout(() => {
      setAlerts(prev => prev.filter(a => a.id !== id));
    }, 12000);
  }, []);

  // Monitor positions for changes (detect opens/closes)
  useEffect(() => {
    let cancelled = false;
    let intervalId;

    async function monitor() {
      try {
        const [botRes, posRes, accRes] = await Promise.allSettled([
          fetchBotStatus(),
          fetchPositions(),
          fetchAccount(),
        ]);

        if (cancelled) return;

        const botData = botRes.status === 'fulfilled' ? botRes.value : null;
        const currentPositions = posRes.status === 'fulfilled' ? (Array.isArray(posRes.value) ? posRes.value : []) : [];
        const accountData = accRes.status === 'fulfilled' ? accRes.value : null;

        // Detect position changes (only after first load to establish baseline)
        if (initialized.current && prevPositions.length >= 0) {
          const prevSymbols = new Set(prevPositions.map(p => p.symbol || p.asset_id));
          const currentSymbols = new Set(currentPositions.map(p => p.symbol || p.asset_id));

          // New positions opened
          for (const pos of currentPositions) {
            const key = pos.symbol || pos.asset_id;
            if (!prevSymbols.has(key)) {
              const pnlPct = parseFloat(pos.unrealized_plpc || 0) * 100;
              addAlert('position_opened', `Opened ${pos.symbol}`, {
                symbol: pos.symbol,
                qty: parseFloat(pos.qty || 0).toFixed(6),
                entry: parseFloat(pos.avg_entry_price || 0).toFixed(2),
                side: pos.side || 'long',
              });
            }
          }

          // Positions closed
          for (const prevPos of prevPositions) {
            const key = prevPos.symbol || prevPos.asset_id;
            if (!currentSymbols.has(key)) {
              // Check if it was a stop-loss or take-profit
              const unrealizedPnlPct = parseFloat(prevPos.unrealized_plpc || 0) * 100;
              const closeType = unrealizedPnlPct <= -2 ? 'stop_loss_hit' : 'position_closed';
              addAlert(closeType, `Closed ${prevPos.symbol}`, {
                symbol: prevPos.symbol,
                pnl: parseFloat(prevPos.unrealized_pl || 0).toFixed(2),
                pnlPct: unrealizedPnlPct.toFixed(1),
              });
            }
          }

          // Check for bot status alerts
          if (botData) {
            const risk = botData.risk || {};
            const currentDailyPnlPct = parseFloat(risk.dailyPnlPctStr || '0');

            // Bot trading status changes
            if (risk.status === 'STOPPED_LOSS' && prevDailyPnl !== null) {
              addAlert('daily_loss_limit', 'Daily loss limit reached - Bot stopped', {
                dailyPnl: risk.dailyPnlPctStr,
              });
            } else if (risk.status === 'STOPPED_PROFIT' && prevDailyPnl !== null) {
              addAlert('daily_target', 'Daily profit target reached!', {
                dailyPnl: risk.dailyPnlPctStr,
              });
            }

            // SL/TP alerts from bot
            if (botData.alerts && botData.alerts.length > 0) {
              for (const a of botData.alerts) {
                addAlert(a.type === 'stop_loss' ? 'stop_loss_hit' : 'take_profit_hit', a.message, {
                  symbol: a.symbol,
                });
              }
            }

            setPrevDailyPnl(currentDailyPnlPct);
          }
        }

        // Update baseline
        setPrevPositions(currentPositions);
        initialized.current = true;

      } catch (e) {
        // Silently fail — monitoring should be resilient
        console.warn('Alert monitor error:', e);
      }
    }

    // Initial check after 5s (let main dashboard load first)
    const initTimeout = setTimeout(() => {
      monitor();
      intervalId = setInterval(monitor, 15000);
    }, 5000);

    return () => {
      cancelled = true;
      clearTimeout(initTimeout);
      clearInterval(intervalId);
    };
  }, [addAlert, prevPositions]);

  // Dismiss alert
  const dismissAlert = (id) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  };

  // Color classes
  const borderColor = (color) => {
    switch (color) {
      case 'green': return 'border-[var(--accent-green)]/40';
      case 'red': return 'border-[var(--accent-red)]/40';
      case 'amber': return 'border-[var(--accent-amber)]/40';
      case 'blue': return 'border-[var(--accent-blue)]/40';
      default: return 'border-[var(--border)]';
    }
  };

  const bgColor = (color) => {
    switch (color) {
      case 'green': return 'bg-[var(--accent-green)]/5';
      case 'red': return 'bg-[var(--accent-red)]/5';
      case 'amber': return 'bg-[var(--accent-amber)]/5';
      case 'blue': return 'bg-[var(--accent-blue)]/5';
      default: return 'bg-[var(--bg-card)]';
    }
  };

  const textColor = (color) => {
    switch (color) {
      case 'green': return 'text-[var(--accent-green)]';
      case 'red': return 'text-[var(--accent-red)]';
      case 'amber': return 'text-[var(--accent-amber)]';
      case 'blue': return 'text-[var(--accent-blue)]';
      default: return 'text-[var(--text-primary)]';
    }
  };

  return (
    <>
      {/* Toast container — fixed top-right */}
      <div
        ref={alertContainerRef}
        className="fixed top-16 right-4 z-50 space-y-2 pointer-events-none"
        style={{ maxWidth: '380px' }}
      >
        {alerts.map(alert => (
          <div
            key={alert.id}
            className={`pointer-events-auto animate-slide-in rounded-lg border ${borderColor(alert.config.color)} ${bgColor(alert.config.color)} shadow-lg backdrop-blur-sm p-3 flex gap-3 items-start`}
          >
            <span className="text-xl shrink-0">{alert.config.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold ${textColor(alert.config.color)}`}>
                  {alert.config.label}
                </span>
                <span className="text-[10px] text-[var(--text-muted)]">
                  {alert.time.toLocaleTimeString()}
                </span>
              </div>
              <p className="text-xs text-[var(--text-primary)] mt-0.5">{alert.message}</p>
              {alert.details && Object.keys(alert.details).length > 0 && (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--text-muted)]">
                  {Object.entries(alert.details).map(([k, v]) => (
                    v != null && <span key={k}>{k}: {v}</span>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => dismissAlert(alert.id)}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0 text-xs"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Minimal inline indicator (shows alert count for the tab) */}
      {alerts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-40 md:hidden pointer-events-none">
          <span className="bg-[var(--accent-blue)] text-white text-xs font-bold px-2 py-1 rounded-full shadow-lg">
            {alerts.length} alert{alerts.length > 1 ? 's' : ''}
          </span>
        </div>
      )}
    </>
  );
}