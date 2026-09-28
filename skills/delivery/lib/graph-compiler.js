"use strict";

const crypto = require("crypto");
const { stringify, stable } = require("./stable-json");
const { compareId, validateGraph } = require("./graph-validator");

function compileGraph(graph, options) {
  const validation = validateGraph(graph);
  if (!validation.ok) {
    const err = new Error("invalid graph: " + validation.errors.join("; "));
    err.errors = validation.errors;
    throw err;
  }
  const graphProfile = graph.policy && graph.policy.profile;
  const requestedProfile = options && options.profile;
  if (requestedProfile && graphProfile && requestedProfile !== graphProfile) {
    throw new Error("profile override conflicts with graph policy profile");
  }
  if (requestedProfile && !["neutral", "software-delivery"].includes(requestedProfile)) {
    throw new Error("unsupported profile " + requestedProfile);
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const tasks = validation.order.map((id) => {
    const node = byId.get(id);
    const incoming = graph.edges.filter((e) => e.to === id).sort((a, b) => compareId(a.from, b.from));
    return {
      id,
      title: node.label,
      dependsOn: incoming.map((e) => e.from),
      dependencyPolicy: Object.fromEntries(incoming.filter((e) => Object.keys(e.policy || {}).length).map((e) => [e.from, stable(e.policy)])),
      policy: stable(node.policy || {}),
    };
  });
  const manifest = {
    version: 1,
    profile: requestedProfile || graphProfile || "neutral",
    sourcePath: graph.sourcePath || null,
    policy: stable(graph.policy || {}),
    tasks,
  };
  const bytes = stringify(manifest);
  return { manifest, digest: crypto.createHash("sha256").update(bytes).digest("hex"), bytes };
}

module.exports = { compileGraph };
