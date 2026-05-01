// Learning Status API - DEF-13
// Returns learning system summary: reward scores, strategy confidence,
// market regime, top/blacklisted symbols, adaptation state.
// Called by the dashboard LearningDashboard component.

import { loadLearningState } from "./lib/state-store.mjs";
import { getLearningSummary } from "./lib/learning-system.mjs";

export default async () => {
  try {
    const state = await loadLearningState();
    const summary = getLearningSummary(state);

    return new Response(JSON.stringify({
      timestamp: new Date().toISOString(),
      ...summary,
    }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: err.message,
      timestamp: new Date().toISOString(),
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
