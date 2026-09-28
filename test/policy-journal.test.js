"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { readJournal, writeJournal } = require("../skills/delivery/lib/policy-journal");

test("writes private durable journal with checksum", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentx-journal-"));
  const file = path.join(dir, "run.json");

  writeJournal(file, { run: "run_1", requests: [{ id: "req_1", op: "task-create" }] });
  const loaded = readJournal(file);

  assert.equal(loaded.run, "run_1");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
});

test("fails closed on journal corruption", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentx-journal-"));
  const file = path.join(dir, "run.json");

  writeJournal(file, { run: "run_1", request: "req_1" });
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  payload.run = "run_2";
  fs.writeFileSync(file, JSON.stringify(payload));

  assert.throws(() => readJournal(file), /checksum mismatch/);
});
