#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");

const args = flags(process.argv.slice(2));
const provider = args.provider;
const scenario = args.scenario;
const approved = args["approve-live"] === true;

if (!provider && !scenario) usage(2);
if (!approved) {
  console.log(JSON.stringify({ ok: false, requiresApproval: true, reason: "live Orca probes mutate disposable runs/workspaces; rerun with --approve-live" }));
  process.exit(3);
}

const validProviders = new Set(["claude", "codex", "omp", "antigravity"]);
const validScenarios = new Set(["quota-fallback", "ambiguous-hold", "crash-recovery", "gates-artifacts-failure-propagation", "rollback-drain"]);
if (provider && !validProviders.has(provider)) fail("unsupported provider " + provider);
if (scenario && !validScenarios.has(scenario)) fail("unsupported scenario " + scenario);

const status = call(["status"]);
const run = call(["orchestration", "run-create", "--objective", "AgentX live probe " + (provider || scenario)]);
const runId = (((run.result || {}).run || {}).id) || (run.result || {}).runId;
if (!runId) fail("run-create returned no run id", { run });

if (provider) providerProbe(provider, runId, status);
else scenarioProbe(scenario, runId, status);

function providerProbe(id, runId, status) {
  const agent = id;
  const spec = "AgentX live probe. Send heartbeat subject ack, then worker_done --outcome succeeded with subject probe ok.";
  const start = call(["orchestration", "worker-start", "--run", runId, "--agent", agent, "--worktree", "current", "--spec", spec, "--task-title", "probe-" + id, "--timeout-ms", "120000"]);
  const dispatchId = (start.result || {}).dispatchId;
  if (!dispatchId) fail("worker-start returned no dispatch id", { start });
  console.log(JSON.stringify({ ok: true, kind: "provider", provider: id, runId, dispatchId, orca: (((status.result || {}).runtime || {}).appVersion || null) }));
}

function scenarioProbe(name, runId, status) {
  console.log(JSON.stringify({ ok: true, kind: "scenario-initializer", scenario: name, runId, orca: (((status.result || {}).runtime || {}).appVersion || null), note: "live scenario run initialized; execute scenario-specific assertions from the phase plan" }));
}

function call(argv) {
  return JSON.parse(execFileSync("orca", [...argv, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 << 20 }));
}
function fail(message, extra) { console.log(JSON.stringify(Object.assign({ ok: false, error: message }, extra || {}))); process.exit(1); }
function flags(argv) { const out = {}; for (let i=0;i<argv.length;i++) if (argv[i].startsWith("--")) { const k=argv[i].slice(2); const v=argv[i+1]; if (v && !v.startsWith("--")) { out[k]=v; i++; } else out[k]=true; } return out; }
function usage(code) { console.log("usage: node probe/run-orchestration-probes.js [--provider claude|codex|omp|antigravity | --scenario name] --approve-live"); process.exit(code); }
