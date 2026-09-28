"use strict";

function decideFallback(taskPolicy, graphPolicy, failure, attempted) {
  const fallbacks = (taskPolicy && taskPolicy.fallback) || [];
  if (!fallbacks.length) return { action: "block", reason: "no fallback configured" };
  if (!terminalNoWrite(failure)) return { action: "hold", reason: "failure is not terminal no-write" };
  if (!tupleAllowed((graphPolicy || {}).fallbackTuples || [], failure)) return { action: "hold", reason: "failure tuple is not allowlisted" };
  const providers = (graphPolicy && graphPolicy.providers) || {};
  const next = fallbacks.find((id) => !(attempted || []).includes(id) && eligibleProvider(providers, id));
  return next ? { action: "retry", provider: next } : { action: "block", reason: "fallback exhausted" };
}

function eligibleProvider(providers, id) {
  const provider = providers[id];
  return !!provider && provider.fallbackEligible === true;
}

function tupleAllowed(tuples, f) {
  return tuples.some((t) => t.errorCode === f.errorCode && t.failedStage === f.failedStage && t.effects === f.effects);
}
function terminalNoWrite(f) { return f && f.terminal === true && ["none", "no-write"].includes(f.effects); }

module.exports = { decideFallback };
