"use strict";

const crypto = require("crypto");
const { buildLedger, operationBy } = require("./request-ledger");
const { readJournal, writeJournal } = require("./policy-journal");

function createPlan(compiled, options) {
  const nonce = (options && options.nonce) || crypto.randomBytes(12).toString("hex");
  const ledger = buildLedger(compiled, nonce);
  return { version: 1, nonce, digest: compiled.digest, manifest: compiled.manifest, ledger, receipts: {}, ids: { tasks: {} }, state: "planned" };
}

function loadOrCreatePlan(journalPath, compiled, options) {
  try {
    const existing = readJournal(journalPath);
    if (existing.digest !== compiled.digest) throw new Error("journal digest does not match graph digest");
    return existing;
  } catch (e) {
    if (!/no such file|ENOENT/.test(String(e.message || e))) throw e;
    const plan = createPlan(compiled, options);
    return writeJournal(journalPath, plan);
  }
}

function materialize(compiled, adapter, journalPath, options) {
  let state = loadOrCreatePlan(journalPath, compiled, options || {});
  if ((options || {}).dryRun) return state;
  state = ensureRun(state, adapter, journalPath, options || {});
  for (const task of state.manifest.tasks) state = ensureTask(state, adapter, journalPath, task);
  for (const task of state.manifest.tasks) state = ensureGates(state, adapter, journalPath, task);
  state.state = "materialized";
  return writeJournal(journalPath, state);
}

function ensureRun(state, adapter, journalPath, options) {
  if (state.ids.runId) return state;
  const op = operationBy(state.ledger, "run-create", "run");
  const receipt = recoverOrCall(adapter, op.requestId, () => adapter.runCreate(options.objective || "AgentX graph " + state.digest, op.requestId));
  state.receipts[op.requestId] = receipt;
  state.ids.runId = extract(receipt, ["runId", "id"], ["run", "result"]);
  if (!state.ids.runId) throw new Error("run-create receipt did not include run id");
  return writeJournal(journalPath, state);
}

function ensureTask(state, adapter, journalPath, task) {
  if (state.ids.tasks[task.id]) return state;
  const op = operationBy(state.ledger, "task-create", task.id);
  const deps = task.dependsOn.map((id) => state.ids.tasks[id]).filter(Boolean);
  if (deps.length !== task.dependsOn.length) throw new Error(task.id + " dependencies are not materialized");
  const receipt = recoverOrCall(adapter, op.requestId, () => adapter.taskCreate(state.ids.runId, task, deps, op.requestId));
  state.receipts[op.requestId] = receipt;
  state.ids.tasks[task.id] = extract(receipt, ["taskId", "id"], ["task", "result"]);
  if (!state.ids.tasks[task.id]) throw new Error("task-create receipt did not include task id for " + task.id);
  return writeJournal(journalPath, state);
}

function ensureGates(state, adapter, journalPath, task) {
  state.ids.gates = state.ids.gates || {};
  for (const [parent, policy] of Object.entries(task.dependencyPolicy || {})) {
    if (!policy.gate && !policy.handoff) continue;
    const id = parent + "->" + task.id;
    if (state.ids.gates[id]) continue;
    const op = operationBy(state.ledger, "gate-create", id);
    const receipt = recoverOrCall(adapter, op.requestId, () => adapter.gateCreate(state.ids.tasks[task.id], "AgentX gate " + id, ["accept", "reject"], op.requestId));
    state.receipts[op.requestId] = receipt;
    state.ids.gates[id] = extract(receipt, ["gateId", "id"], ["gate", "result"]);
    if (!state.ids.gates[id]) throw new Error("gate-create receipt did not include gate id for " + id);
    state = writeJournal(journalPath, state);
  }
  return state;
}

function recoverOrCall(adapter, requestId, call) {
  let seen = null;
  try {
    seen = adapter.requestShow(requestId);
  } catch (_) {
    seen = null;
  }
  if (requestState(seen) === "completed") return seen;
  return call();
}

function requestState(receipt) {
  return String(((receipt || {}).result || {}).status || ((receipt || {}).result || {}).state || (receipt || {}).status || "");
}

function extract(receipt, fields, containers) {
  const roots = [receipt];
  for (const c of containers) if (receipt && receipt[c]) roots.push(receipt[c]);
  if (receipt && receipt.result) {
    roots.push(receipt.result);
    for (const c of containers) if (receipt.result[c]) roots.push(receipt.result[c]);
  }
  for (const root of roots) for (const field of fields) if (root && root[field]) return root[field];
  return null;
}

module.exports = { createPlan, materialize, loadOrCreatePlan, extract, recoverOrCall };
