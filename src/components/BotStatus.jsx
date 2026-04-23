import { useState, useEffect } from 'react';
import { fetchBotStatus, runBotManual } from '../api';

export default function BotStatus() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState(null);

  const fetchStatus = async () => {
    try {
      const data = await fetchBotStatus();
      setStatus(data);
    } catch (e) {
      setStatus({ status: 'error', error: e.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Poll every 15 seconds for near-real-time cron health monitoring
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleRunBot = async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const result = await runBotManual();
      setRunResult(result);
      await fetchStatus();
    } catch (e) {
      setRunResult({ status: 'error', error: e.message });
    } finally {
      setRunning(false);
    }
  };

  // Format relative time
  const formatTimeAgo = (isoStr) => {
    if (!isoStr) return 'Never';
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m ago`;
  };

  // Format duration
  const formatDuration = (ms) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  if (loading) {
    return (
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-6 text-center">
        <div className="animate-pulse text-[var(--text-muted)]">Loading bot status...</div>
      </div>
    );
  }

  if (!status || status.status === 'error') {
    return (
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--accent-red)]/30 p-4">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚠️</span>
          <div>
            <p className="text-[var(--accent-red)] font-medium">Bot Offline</p>
            <p className="text-xs text-[var(--text-muted)]">{status?.error || 'Cannot connect to trading bot'}</p>
          </div>
        </div>
      </div>
    );
  }

  const risk = status.risk || {};
  const cron = status.cron || {};
  const cronAlerts = status.cronAlerts || [];
  const statusColor = risk.status === 'TRADING' ? 'text-[var(--accent-green)]'
    : risk.status === 'STOPPED_PROFIT' ? 'text-[var(--accent-amber)]'
    : 'text-[var(--accent-red)]';
  const statusBg = risk.status === 'TRADING' ? 'bg-[var(--accent-green)]/10 border-[var(--accent-green)]/30'
    : risk.status === 'STOPPED_PROFIT' ? 'bg-[var(--accent-amber)]/10 border-[var(--accent-amber)]/30'
    : 'bg-[var(--accent-red)]/10 border-[var(--accent-red)]/30';
  const statusIcon = risk.status === 'TRADING' ? '🟢'
    : risk.status === 'STOPPED_PROFIT' ? '🟡'
    : '🔴';

  const cronHasCriticalAlerts = cronAlerts.some(a => a.severity === 'critical');

  return (
    <div className="space-y-4">
      {/* Bot Status Badge */}
      <div className={`rounded-xl border p-4 ${statusBg}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{statusIcon}</span>
            <div>
              <p className={`font-bold ${statusColor}`}>
                {risk.status === 'TRADING' ? 'BOT ACTIVE'
                  : risk.status === 'STOPPED_PROFIT' ? 'TARGET HIT - PAUSED'
                  : 'LOSS LIMIT - STOPPED'}
              </p>
              <p className="text-xs text-[var(--text-muted)]">{status.tradingReason}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-[var(--text-muted)]">Daily P&L</p>
            <p className={`text-lg font-bold ${risk.dailyPnlPct >= 0 ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
              {risk.dailyPnlPctStr}
            </p>
          </div>
        </div>
      </div>

      {/* Cron Health Monitor */}
      <div className={`rounded-xl border p-4 ${
        cronHasCriticalAlerts ? 'bg-[var(--accent-red)]/10 border-[var(--accent-red)]/30'
        : cronAlerts.length > 0 ? 'bg-[var(--accent-amber)]/10 border-[var(--accent-amber)]/30'
        : 'bg-[var(--surface)] border-[var(--border)]'
      }`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-[var(--text-muted)]">
            {cronHasCriticalAlerts ? '🔴' : cronAlerts.length > 0 ? '🟡' : '🟢'} Cron Health
          </h3>
          <span className={`text-xs font-medium px-2 py-0.5 rounded ${
            cronHasCriticalAlerts ? 'bg-[var(--accent-red)]/20 text-[var(--accent-red)]'
            : cronAlerts.length > 0 ? 'bg-[var(--accent-amber)]/20 text-[var(--accent-amber)]'
            : 'bg-[var(--accent-green)]/20 text-[var(--accent-green)]'
          }`}>
            {cronHasCriticalAlerts ? 'UNHEALTHY' : cronAlerts.length > 0 ? 'DEGRADED' : 'HEALTHY'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">Last Run</span>
            <span className={`text-[var(--text-primary)]${cron.minutesSinceLastRun > 15 ? ' text-[var(--accent-red)] font-bold' : ''}`}>
              {formatTimeAgo(cron.lastRun)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">Last Success</span>
            <span className="text-[var(--text-primary)]">{formatTimeAgo(cron.lastSuccess)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">Minutes Since Run</span>
            <span className={`font-bold ${cron.minutesSinceLastRun > 15 ? 'text-[var(--accent-red)]' : cron.minutesSinceLastRun > 10 ? 'text-[var(--accent-amber)]' : 'text-[var(--accent-green)]'}`}>
              {cron.minutesSinceLastRun != null ? `${cron.minutesSinceLastRun}m` : '-'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">Consecutive Errors</span>
            <span className={cron.consecutiveErrors > 0 ? 'text-[var(--accent-red)] font-bold' : 'text-[var(--text-primary)]'}>
              {cron.consecutiveErrors ?? 0}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">Error Rate</span>
            <span className={parseFloat(cron.errorRate) > 10 ? 'text-[var(--accent-amber)]' : 'text-[var(--text-primary)]'}>
              {cron.errorRate ?? '0'}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">Total Runs</span>
            <span className="text-[var(--text-primary)]">{cron.totalRuns ?? 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">Schedule</span>
            <span className="text-[var(--text-primary)] text-xs">{cron.schedule ?? 'every 5 min'}</span>
          </div>
        </div>

        {/* Cron Alerts */}
        {cronAlerts.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-1">
            {cronAlerts.map((alert, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span>{alert.severity === 'critical' ? '🔴' : '🟡'}</span>
                <span className={alert.severity === 'critical' ? 'text-[var(--accent-red)]' : 'text-[var(--accent-amber)]'}>
                  {alert.message}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Recent Run History */}
        {cron.recentRuns && cron.recentRuns.length > 0 && (
          <details className="mt-3">
            <summary className="text-xs text-[var(--accent-blue)] cursor-pointer">
              View run history ({cron.recentRuns.length} recent)
            </summary>
            <div className="mt-1 max-h-32 overflow-y-auto font-mono text-[10px] bg-[var(--bg-deep)] rounded p-2 space-y-0.5">
              {cron.recentRuns.slice().reverse().map((run, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-[var(--text-muted)]">
                    {new Date(run.time).toLocaleTimeString()}
                  </span>
                  <span className={run.success ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}>
                    {run.success ? 'OK' : 'ERR'}
                  </span>
                  {run.durationMs != null && (
                    <span className="text-[var(--text-muted)]">{formatDuration(run.durationMs)}</span>
                  )}
                  {run.error && (
                    <span className="text-[var(--accent-red)] truncate">{run.error}</span>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Risk Parameters */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-4">
        <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">⚙️ Risk Configuration</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">Max Position</span>
            <span className="text-[var(--text-primary)]">{risk.maxPositions || 5} positions</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">SL / TP</span>
            <span className="text-[var(--text-primary)]">{((risk.stopLossPct || 0.02) * 100).toFixed(0)}% / {((risk.takeProfitPct || 0.04) * 100).toFixed(0)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">Loss Limit</span>
            <span className="text-[var(--accent-red)]">-{((risk.lossLimitPct || 0.03) * 100).toFixed(0)}% daily</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">Profit Target</span>
            <span className="text-[var(--accent-green)]">+{((risk.profitTargetPct || 0.08) * 100).toFixed(0)}% daily</span>
          </div>
        </div>
      </div>

      {/* Alerts (existing - position alerts) */}
      {status.alerts && status.alerts.length > 0 && (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--accent-amber)]/30 p-4">
          <h3 className="text-sm font-medium text-[var(--accent-amber)] mb-2">🔔 Active Alerts</h3>
          {status.alerts.map((alert, i) => (
            <div key={i} className="text-sm py-1 flex items-center gap-2">
              <span>{alert.type === 'stop_loss' ? '🛑' : '🎯'}</span>
              <span className="text-[var(--text-primary)]">{alert.symbol}</span>
              <span className="text-[var(--text-muted)] text-xs">{alert.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Cron Scheduling Status */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-4">
        <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">⏱️ Scheduling</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">Netlify Cron</span>
            <span className="text-[var(--accent-green)]">Every 5 min (built-in)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">GitHub Actions</span>
            <span className="text-[var(--accent-blue)]">
              {cron.lastRun ? 'Configured' : 'Pending setup'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">Schedule</span>
            <span className="text-[var(--text-primary)]">24/7 (crypto markets)</span>
          </div>
          {cron.isHealthy && (
            <div className="flex justify-between">
              <span className="text-[var(--text-muted)]">Health</span>
              <span className="text-[var(--accent-green)]">
                Running {cron.minutesSinceLastRun != null && cron.minutesSinceLastRun < 10
                  ? `(last ${cron.minutesSinceLastRun}m ago)`
                  : '(active)'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Manual Trigger */}
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-[var(--text-muted)]">Automatic cron runs every 5 min. Run manually to scan now.</p>
          <button
            onClick={handleRunBot}
            disabled={running}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              running
                ? 'bg-[var(--surface-hover)] text-[var(--text-muted)] cursor-not-allowed'
                : 'bg-[var(--accent-blue)] text-white hover:bg-[var(--accent-blue)]/80'
            }`}
          >
            {running ? '⏳ Running...' : '▶ Run Now'}
          </button>
        </div>

        {/* Run Results */}
        {runResult && (
          <div className={`mt-3 rounded-lg border p-3 text-xs ${
            runResult.status === 'error'
              ? 'bg-[var(--accent-red)]/10 border-[var(--accent-red)]/30'
              : 'bg-[var(--surface)] border-[var(--border)]'
          }`}>
            {runResult.status === 'error' ? (
              <div>
                <p className="text-[var(--accent-red)] font-medium">Run failed: {runResult.error}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Risk</span>
                  <span className={runResult.tradingAllowed ? 'text-[var(--accent-green)]' : 'text-[var(--accent-amber)]'}>
                    {runResult.tradingAllowed ? 'ALLOWED' : 'BLOCKED'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Risk Reason</span>
                  <span className="text-[var(--text-primary)]">{runResult.riskReason}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Positions</span>
                  <span className="text-[var(--text-primary)]">{runResult.positions}</span>
                </div>
                {runResult.actions && runResult.actions.length > 0 && (
                  <div>
                    <p className="text-[var(--text-muted)] mb-1">Actions taken:</p>
                    {runResult.actions.map((a, i) => (
                      <div key={i} className="flex gap-2 ml-2">
                        <span className={a.success ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}>
                          {a.type === 'close' ? '🔒' : '📈'}
                        </span>
                        <span className="text-[var(--text-primary)]">{a.symbol}</span>
                        <span className="text-[var(--text-muted)]">{a.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
                {runResult.logs && runResult.logs.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-[var(--accent-blue)] cursor-pointer">View logs ({runResult.logs.length})</summary>
                    <div className="mt-1 max-h-40 overflow-y-auto font-mono text-[var(--text-muted)] bg-[var(--bg-deep)] rounded p-2">
                      {runResult.logs.map((log, i) => (
                        <div key={i}>{log}</div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}