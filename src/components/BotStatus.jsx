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
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRunBot = async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const result = await runBotManual();
      setRunResult(result);
      // Refresh status after run
      await fetchStatus();
    } catch (e) {
      setRunResult({ status: 'error', error: e.message });
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] p-6 text-center">
        <div className="animate-pulse text-[#8b8fa3]">Loading bot status...</div>
      </div>
    );
  }

  if (!status || status.status === 'error') {
    return (
      <div className="bg-[#1a1d29] rounded-xl border border-[#ff1744]/30 p-4">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚠️</span>
          <div>
            <p className="text-[#ff1744] font-medium">Bot Offline</p>
            <p className="text-xs text-[#8b8fa3]">{status?.error || 'Cannot connect to trading bot'}</p>
          </div>
        </div>
      </div>
    );
  }

  const risk = status.risk || {};
  const statusColor = risk.status === 'TRADING' ? 'text-[#00c853]'
    : risk.status === 'STOPPED_PROFIT' ? 'text-[#ff9100]'
    : 'text-[#ff1744]';
  const statusBg = risk.status === 'TRADING' ? 'bg-[#00c853]/10 border-[#00c853]/30'
    : risk.status === 'STOPPED_PROFIT' ? 'bg-[#ff9100]/10 border-[#ff9100]/30'
    : 'bg-[#ff1744]/10 border-[#ff1744]/30';
  const statusIcon = risk.status === 'TRADING' ? '🟢'
    : risk.status === 'STOPPED_PROFIT' ? '🟡'
    : '🔴';

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
              <p className="text-xs text-[#8b8fa3]">{status.tradingReason}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-[#8b8fa3]">Daily P&L</p>
            <p className={`text-lg font-bold ${risk.dailyPnlPct >= 0 ? 'text-[#00c853]' : 'text-[#ff1744]'}`}>
              {risk.dailyPnlPctStr}
            </p>
          </div>
        </div>
      </div>

      {/* Risk Parameters */}
      <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] p-4">
        <h3 className="text-sm font-medium text-[#8b8fa3] mb-3">⚙️ Risk Configuration</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex justify-between">
            <span className="text-[#8b8fa3]">Max Position</span>
            <span className="text-white">{risk.maxPositions || 5} positions</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8b8fa3]">SL / TP</span>
            <span className="text-white">{((risk.stopLossPct || 0.02) * 100).toFixed(0)}% / {((risk.takeProfitPct || 0.04) * 100).toFixed(0)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8b8fa3]">Loss Limit</span>
            <span className="text-[#ff1744]">-{((risk.lossLimitPct || 0.03) * 100).toFixed(0)}% daily</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8b8fa3]">Profit Target</span>
            <span className="text-[#00c853]">+{((risk.profitTargetPct || 0.08) * 100).toFixed(0)}% daily</span>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {status.alerts && status.alerts.length > 0 && (
        <div className="bg-[#1a1d29] rounded-xl border border-[#ff9100]/30 p-4">
          <h3 className="text-sm font-medium text-[#ff9100] mb-2">🔔 Active Alerts</h3>
          {status.alerts.map((alert, i) => (
            <div key={i} className="text-sm py-1 flex items-center gap-2">
              <span>{alert.type === 'stop_loss' ? '🛑' : '🎯'}</span>
              <span className="text-white">{alert.symbol}</span>
              <span className="text-[#8b8fa3] text-xs">{alert.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Manual Trigger */}
      <div className="bg-[#1a1d29] rounded-xl border border-[#2d3148] p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-[#8b8fa3]">Bot runs automatically every 5 min. Run manually to scan now.</p>
          <button
            onClick={handleRunBot}
            disabled={running}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              running
                ? 'bg-[#252836] text-[#8b8fa3] cursor-not-allowed'
                : 'bg-[#448aff] text-white hover:bg-[#448aff]/80'
            }`}
          >
            {running ? '⏳ Running...' : '▶ Run Now'}
          </button>
        </div>

        {/* Run Results */}
        {runResult && (
          <div className={`mt-3 rounded-lg border p-3 text-xs ${
            runResult.status === 'error'
              ? 'bg-[#ff1744]/10 border-[#ff1744]/30'
              : 'bg-[#1a1d29] border-[#2d3148]'
          }`}>
            {runResult.status === 'error' ? (
              <div>
                <p className="text-[#ff1744] font-medium">Run failed: {runResult.error}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-[#8b8fa3]">Risk</span>
                  <span className={runResult.tradingAllowed ? 'text-[#00c853]' : 'text-[#ff9100]'}>
                    {runResult.tradingAllowed ? 'ALLOWED' : 'BLOCKED'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8b8fa3]">Risk Reason</span>
                  <span className="text-white">{runResult.riskReason}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8b8fa3]">Positions</span>
                  <span className="text-white">{runResult.positions}</span>
                </div>
                {runResult.actions && runResult.actions.length > 0 && (
                  <div>
                    <p className="text-[#8b8fa3] mb-1">Actions taken:</p>
                    {runResult.actions.map((a, i) => (
                      <div key={i} className="flex gap-2 ml-2">
                        <span className={a.success ? 'text-[#00c853]' : 'text-[#ff1744]'}>
                          {a.type === 'close' ? '🔒' : '📈'}
                        </span>
                        <span className="text-white">{a.symbol}</span>
                        <span className="text-[#8b8fa3]">{a.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
                {runResult.logs && runResult.logs.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-[#448aff] cursor-pointer">View logs ({runResult.logs.length})</summary>
                    <div className="mt-1 max-h-40 overflow-y-auto font-mono text-[#8b8fa3] bg-[#0f1117] rounded p-2">
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
