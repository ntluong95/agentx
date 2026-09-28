"use strict";

const GRAPH_POLICY_KEYS = new Set(["profile", "maxParallel", "fallbackTuples", "providers", "communication", "approval"]);
const NODE_POLICY_KEYS = new Set(["agent", "fallback", "workspace", "artifacts", "manager", "subordinates", "communication", "outcome"]);
const EDGE_POLICY_KEYS = new Set(["gate", "handoff", "artifacts"]);
const ARTIFACT_KEYS = new Set(["path", "required", "mediaType", "schema", "digest", "size", "retention", "producer", "consumer", "validation"]);
const PROVIDER_KEYS = new Set(["orcaAgent", "capabilities", "model", "effort", "fallbackEligible"]);
const COMMUNICATION_KEYS = new Set(["routes"]);
const COMMUNICATION_ROUTE_KEYS = new Set(["from", "to", "type"]);
const APPROVAL_KEYS = new Set(["required", "scope", "expiresInSeconds"]);
const OUTCOME_KEYS = new Set(["schema", "required"]);
const PROFILES = new Set(["neutral", "software-delivery"]);
const WORKSPACES = new Set(["shared-readonly", "shared-serialized-writer", "orca-worktree"]);

function validateGraph(graph) {
  const errors = [...(graph.diagnostics || [])];
  const ids = new Set(graph.nodes.map((n) => n.id));
  const outgoing = new Map(graph.nodes.map((n) => [n.id, []]));
  const indegree = new Map(graph.nodes.map((n) => [n.id, 0]));
  const degree = new Map(graph.nodes.map((n) => [n.id, 0]));
  const seenEdges = new Set();

  for (const edge of graph.edges) {
    const edgeId = edge.from + "->" + edge.to;
    if (!ids.has(edge.from)) errors.push(edge.line + ": unknown source node " + edge.from);
    if (!ids.has(edge.to)) errors.push(edge.line + ": unknown target node " + edge.to);
    if (edge.from === edge.to) errors.push(edge.line + ": self dependency " + edge.from);
    if (seenEdges.has(edgeId)) errors.push(edge.line + ": duplicate dependency " + edgeId);
    seenEdges.add(edgeId);
    validateEdgePolicy(edge, errors);
    if (ids.has(edge.from) && ids.has(edge.to) && !seenEdges.has(edgeId + ":counted")) {
      outgoing.get(edge.from).push(edge.to);
      indegree.set(edge.to, indegree.get(edge.to) + 1);
      degree.set(edge.from, degree.get(edge.from) + 1);
      degree.set(edge.to, degree.get(edge.to) + 1);
      seenEdges.add(edgeId + ":counted");
    }
  }

  for (const [id, count] of degree.entries()) {
    if (graph.nodes.length > 1 && count === 0) errors.push(id + ": disconnected node");
  }
  validateWeakConnectivity(graph.nodes, graph.edges, errors);

  const queue = [...indegree.entries()].filter(([, n]) => n === 0).map(([id]) => id).sort(compareId);
  const order = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    order.push(id);
    for (const next of outgoing.get(id).sort(compareId)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  if (order.length !== graph.nodes.length) errors.push("graph contains a cycle");

  for (const node of graph.nodes) validateNodePolicy(node, errors, ids);
  validatePolicy(graph.policy || {}, errors, ids);
  return { ok: errors.length === 0, errors, order };
}

function validateWeakConnectivity(nodes, edges, errors) {
  if (nodes.length < 2) return;
  const neighbors = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (!neighbors.has(edge.from) || !neighbors.has(edge.to)) continue;
    neighbors.get(edge.from).push(edge.to);
    neighbors.get(edge.to).push(edge.from);
  }
  const start = nodes[0].id;
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const id = stack.pop();
    for (const next of neighbors.get(id) || []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  if (seen.size !== nodes.length) errors.push("graph contains disconnected components");
}

function validateNodePolicy(node, errors, nodeIds) {
  const policy = node.policy || {};
  rejectUnknownKeys(node.id, policy, NODE_POLICY_KEYS, errors);
  if (policy.agent != null && !isIdentifier(policy.agent)) errors.push(node.id + ": agent must be a provider id");
  if (policy.manager != null) {
    if (!isIdentifier(policy.manager)) errors.push(node.id + ": manager must be a node id");
    else if (!nodeIds.has(policy.manager)) errors.push(node.id + ": manager references unknown node " + policy.manager);
  }
  if (policy.fallback != null) {
    if (!Array.isArray(policy.fallback) || policy.fallback.length > 5) {
      errors.push(node.id + ": fallback must be an array of at most five provider ids");
    } else {
      for (const item of policy.fallback) {
        if (!isIdentifier(item)) errors.push(node.id + ": fallback entries must be provider ids");
      }
    }
  }
  if (policy.workspace != null && !WORKSPACES.has(policy.workspace)) {
    errors.push(node.id + ": unsupported workspace mode " + policy.workspace);
  }
  validateOutcome(node.id, policy.outcome, errors);
  validateNodeReferences(node.id, "subordinates", policy.subordinates, errors, nodeIds);
  validateNodeReferences(node.id, "communication", policy.communication, errors, nodeIds);
  validateArtifacts(node.id, policy.artifacts, errors);
}

function validateEdgePolicy(edge, errors) {
  const policy = edge.policy || {};
  const prefix = edge.from + "->" + edge.to;
  rejectUnknownKeys(prefix, policy, EDGE_POLICY_KEYS, errors);
  if (policy.gate != null && !isIdentifier(policy.gate)) errors.push(prefix + ": gate must be an id");
  if (policy.handoff != null && typeof policy.handoff !== "boolean") errors.push(prefix + ": handoff must be boolean");
  validateArtifacts(prefix, policy.artifacts, errors);
}

function validateArtifacts(prefix, artifacts, errors) {
  if (artifacts == null) return;
  if (!Array.isArray(artifacts)) {
    errors.push(prefix + ": artifacts must be an array");
    return;
  }
  for (const artifact of artifacts) {
    if (!isPlainObject(artifact)) {
      errors.push(prefix + ": artifact entries must be objects");
      continue;
    }
    rejectUnknownKeys(prefix + ": artifact", artifact, ARTIFACT_KEYS, errors);
    if (!safeRelativePath(artifact.path)) errors.push(prefix + ": artifact path must be safe and relative");
    if (artifact.required != null && typeof artifact.required !== "boolean") errors.push(prefix + ": artifact required must be boolean");
    if (artifact.size != null && (!Number.isInteger(artifact.size) || artifact.size < 0)) errors.push(prefix + ": artifact size must be a non-negative integer");
    for (const field of ["mediaType", "schema", "digest", "retention", "producer", "consumer", "validation"]) {
      if (artifact[field] != null && typeof artifact[field] !== "string") errors.push(prefix + ": artifact " + field + " must be a string");
    }
  }
}

function validatePolicy(policy, errors, nodeIds) {
  rejectUnknownKeys("graph policy", policy, GRAPH_POLICY_KEYS, errors);
  if (policy.profile != null && !PROFILES.has(policy.profile)) errors.push("unsupported profile " + policy.profile);
  validateProviders(policy.providers, errors);
  validateCommunication(policy.communication, errors, nodeIds);
  validateApproval(policy.approval, errors);
  if (policy.fallbackTuples != null) {
    if (!Array.isArray(policy.fallbackTuples)) {
      errors.push("fallbackTuples must be an array");
      return;
    }
    for (const tuple of policy.fallbackTuples) {
      if (!isPlainObject(tuple)) {
        errors.push("fallback tuple must be an object");
        continue;
      }
      rejectUnknownKeys("fallback tuple", tuple, new Set(["errorCode", "failedStage", "effects"]), errors);
      if (!exactTuplePart(tuple.errorCode) || !exactTuplePart(tuple.failedStage) || !exactTuplePart(tuple.effects)) {
        errors.push("fallback tuple must include errorCode, failedStage, and effects");
      }
      if (tuple.errorCode === "launch_failed") errors.push("generic launch_failed fallback tuple is forbidden");
    }
  }
  if (policy.maxParallel != null && (!Number.isInteger(policy.maxParallel) || policy.maxParallel < 1)) {
    errors.push("maxParallel must be a positive integer");
  }
}

function validateProviders(providers, errors) {
  if (providers == null) return;
  if (!isPlainObject(providers)) {
    errors.push("providers must be an object");
    return;
  }
  for (const [id, provider] of Object.entries(providers)) {
    if (!isIdentifier(id)) errors.push("provider id must be an identifier");
    if (!isPlainObject(provider)) {
      errors.push("provider " + id + " must be an object");
      continue;
    }
    rejectUnknownKeys("provider " + id, provider, PROVIDER_KEYS, errors);
    if (provider.orcaAgent != null && !isIdentifier(provider.orcaAgent)) errors.push("provider " + id + ": orcaAgent must be an id");
    validateStringArray("provider " + id, "capabilities", provider.capabilities, errors);
    if (provider.model != null && typeof provider.model !== "string") errors.push("provider " + id + ": model must be a string");
    if (provider.effort != null && typeof provider.effort !== "string") errors.push("provider " + id + ": effort must be a string");
    if (provider.fallbackEligible != null && typeof provider.fallbackEligible !== "boolean") errors.push("provider " + id + ": fallbackEligible must be boolean");
  }
}

function validateCommunication(communication, errors, nodeIds) {
  if (communication == null) return;
  if (!isPlainObject(communication)) {
    errors.push("communication must be an object");
    return;
  }
  rejectUnknownKeys("communication", communication, COMMUNICATION_KEYS, errors);
  if (communication.routes == null) return;
  if (!Array.isArray(communication.routes)) {
    errors.push("communication routes must be an array");
    return;
  }
  for (const route of communication.routes) {
    if (!isPlainObject(route)) {
      errors.push("communication route must be an object");
      continue;
    }
    rejectUnknownKeys("communication route", route, COMMUNICATION_ROUTE_KEYS, errors);
    if (!isIdentifier(route.from) || !isIdentifier(route.to)) {
      errors.push("communication route endpoints must be ids");
    } else {
      if (!nodeIds.has(route.from)) errors.push("communication route references unknown node " + route.from);
      if (!nodeIds.has(route.to)) errors.push("communication route references unknown node " + route.to);
    }
    if (route.type != null && !isIdentifier(route.type)) errors.push("communication route type must be an id");
  }
}

function validateApproval(approval, errors) {
  if (approval == null) return;
  if (!isPlainObject(approval)) {
    errors.push("approval must be an object");
    return;
  }
  rejectUnknownKeys("approval", approval, APPROVAL_KEYS, errors);
  if (approval.required != null && typeof approval.required !== "boolean") errors.push("approval required must be boolean");
  if (approval.scope != null && typeof approval.scope !== "string") errors.push("approval scope must be a string");
  if (approval.expiresInSeconds != null && (!Number.isInteger(approval.expiresInSeconds) || approval.expiresInSeconds < 1)) {
    errors.push("approval expiresInSeconds must be a positive integer");
  }
}

function validateOutcome(prefix, outcome, errors) {
  if (outcome == null) return;
  if (!isPlainObject(outcome)) {
    errors.push(prefix + ": outcome must be an object");
    return;
  }
  rejectUnknownKeys(prefix + ": outcome", outcome, OUTCOME_KEYS, errors);
  if (outcome.schema != null && typeof outcome.schema !== "string") errors.push(prefix + ": outcome schema must be a string");
  validateStringArray(prefix + ": outcome", "required", outcome.required, errors);
}

function validateStringArray(prefix, field, value, errors) {
  if (value == null) return;
  if (!Array.isArray(value)) {
    errors.push(prefix + ": " + field + " must be an array");
    return;
  }
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) errors.push(prefix + ": " + field + " entries must be strings");
  }
}

function validateNodeReferences(prefix, field, value, errors, nodeIds) {
  if (value == null) return;
  if (!Array.isArray(value)) {
    errors.push(prefix + ": " + field + " must be an array");
    return;
  }
  for (const item of value) {
    if (!isIdentifier(item)) errors.push(prefix + ": " + field + " entries must be ids");
    else if (!nodeIds.has(item)) errors.push(prefix + ": " + field + " references unknown node " + item);
  }
}

function rejectUnknownKeys(prefix, value, allowed, errors) {
  for (const key of Object.keys(value || {})) {
    if (!allowed.has(key)) errors.push(prefix + ": unknown policy key " + key);
  }
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isIdentifier(value) {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value);
}

function safeRelativePath(value) {
  return (
    typeof value === "string" &&
    value &&
    !value.startsWith("/") &&
    !value.startsWith("\\") &&
    !/^[A-Za-z]:/.test(value) &&
    !value.split(/[\\/]/).includes("..")
  );
}

function exactTuplePart(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]+$/.test(value) && value !== "any" && value !== "unknown";
}

function compareId(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

module.exports = { compareId, validateGraph };
