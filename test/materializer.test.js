"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { compileGraph } = require("../skills/delivery/lib/graph-compiler");
const { parseMermaid } = require("../skills/delivery/lib/graph-parser");
const { materialize } = require("../skills/delivery/lib/materializer");

function compiled() {
  return compileGraph(parseMermaid(`
flowchart TD
%%@agentx {"edge":["a","b"],"gate":"approved"}
a --> b
`));
}

test("materializes one run and dependency-correct tasks", () => {
  const calls = [];
  const adapter = {
    requestShow: (requestId) => ({ result: { status: "absent", requestId } }),
    runCreate: (objective, requestId) => (calls.push(["run", objective, requestId]), { result: { run: { id: "run-1" } } }),
    taskCreate: (run, task, deps, requestId) => (calls.push(["task", run, task.id, deps, requestId]), { result: { task: { id: "task-" + task.id } } }),
    gateCreate: (taskId, question, options, requestId) => (calls.push(["gate", taskId, question, options, requestId]), { result: { gate: { id: "gate-1" } } }),
  };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agentx-mat-")), "journal.json");
  const state = materialize(compiled(), adapter, file, { nonce: "n", objective: "demo" });

  assert.equal(state.ids.runId, "run-1");
  assert.deepEqual(state.ids.tasks, { a: "task-a", b: "task-b" });
  assert.deepEqual(state.ids.gates, { "a->b": "gate-1" });
  assert.equal(calls[0][0], "run");
  assert.equal(calls[0][1], "demo");
  assert.match(calls[0][2], /^[0-9a-f]{32}$/);
  assert.deepEqual(calls.slice(1).map((x) => x.slice(0, 4)), [["task", "run-1", "a", []], ["task", "run-1", "b", ["task-a"]], ["gate", "task-b", "AgentX gate a->b", ["accept", "reject"]]]);
});

test("dry run writes only deterministic ledger", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agentx-mat-")), "journal.json");
  const state = materialize(compiled(), null, file, { nonce: "same", dryRun: true });

  assert.equal(state.state, "planned");
  assert.equal(state.ledger.operations.length, 4);
  assert.equal(materialize(compiled(), null, file, { nonce: "same", dryRun: true }).ledger.operations[0].requestId, state.ledger.operations[0].requestId);
});

test("recovers when request-show misses before mutation", () => {
  const calls = [];
  const adapter = {
    requestShow: () => { throw new Error("not found"); },
    runCreate: (objective, requestId) => (calls.push(["run", requestId]), { result: { run: { id: "run-1" } } }),
    taskCreate: (run, task, deps, requestId) => (calls.push(["task", task.id, requestId]), { result: { task: { id: "task-" + task.id } } }),
    gateCreate: (taskId, question, options, requestId) => (calls.push(["gate", requestId]), { result: { gate: { id: "gate-1" } } }),
  };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agentx-mat-")), "journal.json");

  const state = materialize(compiled(), adapter, file, { nonce: "n" });

  assert.equal(state.state, "materialized");
  assert.deepEqual(calls.map((x) => x[0]), ["run", "task", "task", "gate"]);
});
