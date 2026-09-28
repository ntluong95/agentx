"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function assertTrustedOrca(bin, repoRoot) {
  if (!path.isAbsolute(bin)) throw new Error("orca executable must be an absolute path");
  const real = fs.realpathSync(bin);
  const repo = fs.realpathSync(repoRoot || process.cwd());
  if (real === repo || real.startsWith(repo + path.sep)) throw new Error("orca executable must not live inside the repository");
  fs.accessSync(real, fs.constants.X_OK);
  return real;
}

function callOrca(bin, args, options) {
  if (!Array.isArray(args) || args.some((x) => typeof x !== "string")) throw new Error("args must be strings");
  const real = assertTrustedOrca(bin, options && options.repoRoot);
  const out = execFileSync(real, [...args, "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: (options && options.maxBuffer) || (8 << 20),
    timeout: (options && options.timeoutMs) || 30000,
    env: minimalEnvironment(options && options.extraEnvironment),
  });
  return JSON.parse(out || "{}");
}

class OrcaAdapter {
  constructor(bin, options) {
    this.bin = bin;
    this.options = options || {};
  }
  call(args) { return callOrca(this.bin, args, this.options); }
  requestShow(requestId) { return this.call(["orchestration", "request-show", "--request", requestId]); }
  runCreate(objective, requestId) {
    return this.call(["orchestration", "run-create", "--objective", objective, "--retry-request", requestId]);
  }
  taskCreate(runId, task, depTaskIds, requestId) {
    const args = ["orchestration", "task-create", "--run", runId, "--task-title", task.title || task.id, "--spec", taskSpec(task), "--retry-request", requestId];
    if (depTaskIds.length) args.push("--deps", JSON.stringify(depTaskIds));
    return this.call(args);
  }
  gateCreate(taskId, question, options, requestId) {
    const args = ["orchestration", "gate-create", "--task", taskId, "--question", question, "--retry-request", requestId];
    if (options) args.push("--options", JSON.stringify(options));
    return this.call(args);
  }
  gateResolve(gateId, resolution, requestId) {
    return this.call(["orchestration", "gate-resolve", "--id", gateId, "--resolution", resolution, "--retry-request", requestId]);
  }
  taskUpdate(runId, taskId, status, result, requestId) {
    const args = ["orchestration", "task-update", "--run", runId, "--id", taskId, "--status", status, "--retry-request", requestId];
    if (result) args.push("--result", JSON.stringify(result));
    return this.call(args);
  }
}

function taskSpec(task) {
  return ["AgentX task: " + task.id, "Title: " + (task.title || task.id), "Policy: " + JSON.stringify(task.policy || {})].join("\n");
}

function minimalEnvironment(extra) {
  const runtime = process["env"];
  const env = { HOME: runtime.HOME, LANG: runtime.LANG || "C.UTF-8", LC_ALL: runtime.LC_ALL || "C.UTF-8", PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
  for (const [key, value] of Object.entries(extra || {})) if (allowedExtraEnvironmentKey(key)) env[key] = String(value);
  return env;
}

function allowedExtraEnvironmentKey(key) { return /^(AGENTX_|ORCA_)[A-Za-z0-9_]*$/.test(key); }

module.exports = { OrcaAdapter, assertTrustedOrca, callOrca, minimalEnvironment, taskSpec };
