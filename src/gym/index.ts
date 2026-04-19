/**
 * AI Gym — Module barrel
 *
 * All gym-specific code is centralized here. Platform files (web-ui.ts, etc.)
 * import from this module only at registration points.
 * When `gymEnabled: false`, nothing in this module runs.
 */

export { createGymRouter } from "./gym-router.js";
export { startActivityDigest, stopActivityDigest, runActivityDigest } from "./activity-digest.js";
export {
  scoreAllDimensions,
  computeTrends,
  scoreAnalysis,
  scoreCommunication,
  scoreKnowledge,
  scoreAutomation,
  scoreBuilding,
} from "./dimension-scorer.js";
