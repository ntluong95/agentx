"use strict";

const crypto = require("crypto");

function requestId(seed, op, id) {
  return crypto.createHash("sha256").update([seed, op, id].join("\0")).digest("hex").slice(0, 32);
}

function buildLedger(compiled, nonce) {
  const seed = compiled.digest + "\0" + nonce;
  const operations = [{ op: "run-create", id: "run", requestId: requestId(seed, "run-create", "run") }];
  for (const task of compiled.manifest.tasks) {
    operations.push({ op: "task-create", id: task.id, requestId: requestId(seed, "task-create", task.id) });
  }
  for (const task of compiled.manifest.tasks) {
    for (const [parent, policy] of Object.entries(task.dependencyPolicy || {})) {
      if (policy.gate || policy.handoff) {
        const id = parent + "->" + task.id;
        operations.push({ op: "gate-create", id, requestId: requestId(seed, "gate-create", id) });
      }
    }
  }
  return { seed, operations };
}

function operationBy(ledger, op, id) {
  const found = (ledger.operations || []).find((x) => x.op === op && x.id === id);
  if (!found) throw new Error("missing ledger operation " + op + " " + id);
  return found;
}

module.exports = { buildLedger, operationBy, requestId };
