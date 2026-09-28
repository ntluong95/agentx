"use strict";

const ALLOWED = new Set(["status", "question", "handoff", "heartbeat", "worker_done", "escalation"]);

function validateEnvelope(envelope, policy) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return reject("envelope must be an object");
  if (!ALLOWED.has(envelope.type)) return reject("unsupported message type " + envelope.type);
  if (["gate", "policy", "start", "fallback"].includes(envelope.action)) return reject("worker cannot mutate AgentX policy");
  const routes = (((policy || {}).communication || {}).routes || []);
  if (routes.length) {
    if (!envelope.from || !envelope.to) return reject("message route endpoints are required");
    const ok = routes.some((r) => r.from === envelope.from && r.to === envelope.to && (!r.type || r.type === envelope.type));
    if (!ok) return reject("message route is not authorized");
  }
  return { ok: true };
}

function reject(error) { return { ok: false, error }; }

module.exports = { validateEnvelope };
