"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { validateArtifact } = require("../skills/delivery/lib/artifact-validator");
const { decideFallback } = require("../skills/delivery/lib/fallback-policy");
const { validateEnvelope } = require("../skills/delivery/lib/message-policy");

const { writeJournal } = require("../skills/delivery/lib/policy-journal");

test("validates artifacts under the trusted root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentx-art-"));
  fs.mkdirSync(path.join(root, "reports"));
  fs.writeFileSync(path.join(root, "reports", "out.txt"), "ok");
  const rec = validateArtifact(root, { path: "reports/out.txt", size: 2 });

  assert.equal(rec.size, 2);
  assert.throws(() => validateArtifact(root, { path: "reports/out.txt", size: 3 }), /size mismatch/);
  assert.throws(() => validateArtifact(root, { path: "reports/out.txt" }, { maxBytes: 1 }), /size limit/);
  assert.throws(() => validateArtifact(root, { path: "../escape" }), /unsafe/);
});

test("enforces message routes and policy mutation boundary", () => {
  const policy = { communication: { routes: [{ from: "a", to: "b", type: "handoff" }] } };

  assert.equal(validateEnvelope({ type: "handoff", from: "a", to: "b" }, policy).ok, true);
  assert.equal(validateEnvelope({ type: "handoff", from: "b", to: "a" }, policy).ok, false);
  assert.equal(validateEnvelope({ type: "handoff" }, policy).ok, false);
  assert.equal(validateEnvelope({ type: "status", action: "policy" }, {}).ok, false);
});

test("fallback requires exact terminal no-write allowlist", () => {
  const task = { fallback: ["codex", "claude"] };
  const graph = {
    providers: { codex: { fallbackEligible: true }, claude: { fallbackEligible: true }, unknown: { fallbackEligible: false } },
    fallbackTuples: [{ errorCode: "quota", failedStage: "worker-start", effects: "no-write" }],
  };

  assert.deepEqual(decideFallback(task, graph, { errorCode: "quota", failedStage: "worker-start", effects: "no-write", terminal: true }, ["codex"]), { action: "retry", provider: "claude" });
  assert.equal(decideFallback({ fallback: ["unknown"] }, graph, { errorCode: "quota", failedStage: "worker-start", effects: "no-write", terminal: true }, []).action, "block");
  assert.equal(decideFallback(task, graph, { errorCode: "auth", failedStage: "worker-start", effects: "no-write", terminal: true }, []).action, "hold");
});

test("journal refuses public directories", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentx-public-journal-"));
  fs.chmodSync(root, 0o755);
  assert.throws(() => writeJournal(path.join(root, "journal.json"), { version: 1 }), /journal directory must be private/);
});

test("journal refuses public existing journal before use", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentx-public-existing-"));
  fs.chmodSync(root, 0o700);
  const file = path.join(root, "journal.json");
  writeJournal(file, { version: 1 });
  fs.chmodSync(file, 0o644);
  assert.throws(() => require("../skills/delivery/lib/policy-journal").readJournal(file), /journal file must be private/);
});
