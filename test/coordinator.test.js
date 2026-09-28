"use strict";

const assert = require("assert");
const test = require("node:test");
const { blockDescendants, requiredGates, selectReadyTasks } = require("../skills/delivery/lib/coordinator");

const manifest = { tasks: [
  { id: "a", dependsOn: [], policy: { workspace: "shared-readonly" } },
  { id: "b", dependsOn: ["a"], policy: { workspace: "shared-serialized-writer" }, dependencyPolicy: { a: { gate: "approved" } } },
  { id: "c", dependsOn: ["b"], policy: {} },
] };

test("selects ready tasks with dependency and workspace policy", () => {
  const rows = [{ graphId: "a", id: "ta", status: "completed" }, { graphId: "b", id: "tb", status: "ready" }, { graphId: "c", id: "tc", status: "pending" }];
  const selected = selectReadyTasks(manifest, rows, [], 2);

  assert.deepEqual(selected.map((x) => x.manifestTask.id), ["b"]);
  assert.deepEqual(selectReadyTasks(manifest, rows, [{ taskId: "tb", status: "open" }], 2), []);
  assert.deepEqual(selectReadyTasks(manifest, rows, [{ taskId: "tb", status: "resolved" }], 2).map((x) => x.manifestTask.id), ["b"]);

  const unorderedIds = [{ graphId: "a", id: "zz", status: "ready" }, { graphId: "b", id: "aa", status: "ready" }];
  assert.deepEqual(selectReadyTasks({ tasks: [manifest.tasks[0], { ...manifest.tasks[1], dependsOn: [] }] }, unorderedIds, [], 1).map((x) => x.manifestTask.id), ["a"]);
});

test("computes required downstream gates and failed descendants", () => {
  assert.equal(requiredGates(manifest, { tasks: { b: "tb" } })[0].taskId, "tb");
  assert.deepEqual(blockDescendants(manifest, "a", { dispatchId: "d1" }).map((x) => x.id), ["b", "c"]);
});
