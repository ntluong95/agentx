"use strict";

function selectReadyTasks(manifest, taskRows, gateRows, limit) {
  const byId = new Map(taskRows.map((t) => [t.graphId || t.id || t.taskId, t]));
  const closed = new Set((gateRows || []).filter((g) => !isResolved(g)).map((g) => g.taskId || g.task_id));
  const ready = [];
  for (const [index, task] of manifest.tasks.entries()) {
    const row = byId.get(task.id) || {};
    const taskId = row.taskId || row.id || task.id;
    if (closed.has(taskId)) continue;
    if (!depsComplete(task, byId)) continue;
    if (!["ready", "pending", ""].includes(String(row.status || ""))) continue;
    ready.push({ manifestTask: task, taskId, order: index, workspace: (task.policy || {}).workspace || "shared-readonly" });
  }
  return enforceWorkspace(ready.sort((a, b) => a.order - b.order || a.taskId.localeCompare(b.taskId)), limit || Infinity);
}

function requiredGates(manifest, ids) {
  const gates = [];
  for (const task of manifest.tasks) {
    for (const [parent, policy] of Object.entries(task.dependencyPolicy || {})) {
      if (policy.gate || policy.handoff) gates.push({ from: parent, to: task.id, taskId: ids.tasks[task.id], question: gateQuestion(parent, task.id, policy) });
    }
  }
  return gates;
}

function blockDescendants(manifest, failedId, cause) {
  const blocked = [];
  const seen = new Set([failedId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of manifest.tasks) {
      if (seen.has(task.id) || !task.dependsOn.some((id) => seen.has(id))) continue;
      seen.add(task.id); changed = true; blocked.push({ id: task.id, cause });
    }
  }
  return blocked;
}

function depsComplete(task, byId) {
  return task.dependsOn.every((id) => ["completed", "accepted"].includes(String((byId.get(id) || {}).status || "")));
}

function enforceWorkspace(ready, limit) {
  const out = [];
  let writer = false;
  for (const item of ready) {
    if (out.length >= limit) break;
    if (item.workspace === "shared-serialized-writer") { if (writer || out.length) continue; writer = true; }
    else if (writer) continue;
    out.push(item);
  }
  return out;
}

function isResolved(gate) { return ["resolved", "accepted", "approved"].includes(String(gate.status || gate.state || "")); }
function gateQuestion(from, to, policy) { return "AgentX gate " + from + " -> " + to + " " + JSON.stringify(policy); }

module.exports = { blockDescendants, requiredGates, selectReadyTasks };
