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

function minimalEnvironment(extra) {
  const runtime = process["env"];
  const env = {
    HOME: runtime.HOME,
    LANG: runtime.LANG || "C.UTF-8",
    LC_ALL: runtime.LC_ALL || "C.UTF-8",
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  };
  for (const [key, value] of Object.entries(extra || {})) {
    if (!allowedExtraEnvironmentKey(key)) continue;
    env[key] = String(value);
  }
  return env;
}

function allowedExtraEnvironmentKey(key) {
  return /^(AGENTX_|ORCA_)[A-Za-z0-9_]*$/.test(key);
}

module.exports = { assertTrustedOrca, callOrca, minimalEnvironment };
