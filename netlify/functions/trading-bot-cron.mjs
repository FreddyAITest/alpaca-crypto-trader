// Trading Bot Cron v5 - PERSISTENT STATE EDITION
// Scheduled by Netlify every 5 minutes
// Uses Netlify Blobs for state persistence (survives cold starts)
// Delegates to the main trading-bot-v5 logic

import handler from "./trading-bot-v5.mjs";

export default handler;