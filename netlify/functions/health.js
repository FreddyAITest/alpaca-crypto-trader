// Health Check API - Lightweight endpoint for cron monitoring and uptime checks
// Returns bot cron health, alerts, and basic status without full account/position fetch
// Designed for external monitoring services (cron-job.org, UptimeRobot, etc.)

import { getHealth, getAlerts } from "./lib/health-store.js";

export default async (req) => {
  try {
    const health = await getHealth();
    const alerts = await getAlerts(health);

    const hasCritical = alerts.some(a => a.severity === "critical");
    const minutesSinceRun = health.lastRun
      ? Math.round((Date.now() - new Date(health.lastRun).getTime()) / 60000)
      : null;

    const response = {
      status: hasCritical ? "unhealthy" : "healthy",
      timestamp: new Date().toISOString(),
      cron: {
        lastRun: health.lastRun,
        lastSuccess: health.lastSuccess,
        minutesSinceLastRun: minutesSinceRun,
        consecutiveErrors: health.consecutiveErrors,
        totalRuns: health.totalRuns,
        totalErrors: health.totalErrors,
        errorRate: health.totalRuns > 0
          ? ((health.totalErrors / health.totalRuns) * 100).toFixed(1) + "%"
          : "0.0%",
        isHealthy: !hasCritical,
        schedule: "every 5 minutes",
        recentRuns: health.recentRuns.slice(-5),
      },
      alerts: alerts,
    };

    // Return 503 if unhealthy so monitoring services can detect it
    const httpStatus = hasCritical ? 503 : 200;

    return new Response(JSON.stringify(response, null, 2), {
      status: httpStatus,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      status: "error",
      error: err.message,
      timestamp: new Date().toISOString(),
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

// No path config - routed via netlify.toml redirect to preserve redirect precedence