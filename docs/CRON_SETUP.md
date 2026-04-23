# Cron Scheduling Setup

## Current Setup

The trading bot runs automatically via **Netlify Scheduled Functions** every 5 minutes.

- **Function**: `trading-bot-cron`
- **Schedule**: `*/5 * * * *` (every 5 minutes)
- **Config**: `netlify.toml` → `[functions."trading-bot-cron"] schedule = "*/5 * * * *"`
- **Note**: Netlify scheduled functions require a **Pro plan** ($19/mo). If downgraded to free tier, use the external cron fallback below.

## Health Monitoring

The `/api/health` endpoint provides cron health data:

```bash
curl https://cerulean-dieffenbachia-f63827.netlify.app/api/health
```

Response includes:
- `cron.lastRun` — timestamp of last cron run
- `cron.minutesSinceLastRun` — should be < 10 for healthy cron
- `cron.consecutiveErrors` — should be 0
- `cron.isHealthy` — boolean
- `cron.recentRuns` — last 50 runs with success/error status and duration

## External Cron Fallback (cron-job.org)

If Netlify's scheduled functions stop (e.g., plan downgrade), set up external cron:

1. Go to https://cron-job.org and create a free account
2. Create a new job:
   - **Title**: Alpaca Crypto Trader Bot
   - **URL**: `https://cerulean-dieffenbachia-f63827.netlify.app/.netlify/functions/trading-bot-cron`
   - **Method**: GET
   - **Schedule**: Every 5 minutes
   - **Timezone**: UTC
3. Save and enable the job

The cron function is idempotent — safe to call multiple times if overlap occurs.

## Manual Trigger

You can also manually trigger a bot run via the dashboard "Run Bot" button, which calls:

```
POST https://cerulean-dieffenbachia-f63827.netlify.app/api/trading-bot
```

Both `trading-bot` (manual) and `trading-bot-cron` (scheduled) now record health data for monitoring.