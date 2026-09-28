"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { assertTrustedOrca, minimalEnvironment } = require("../skills/delivery/lib/orca-cli-adapter");

test("rejects repository-local orca executable", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "agentx-repo-"));
  const bin = path.join(repo, "orca");
  fs.writeFileSync(bin, "#!/bin/sh\n");
  fs.chmodSync(bin, 0o755);

  assert.throws(() => assertTrustedOrca(bin, repo), /inside the repository/);
});

test("uses minimized environment", () => {
  const env = minimalEnvironment({ AGENTX_TEST: "1", ORCA_TEST: "2" });

  assert.equal(env.AGENTX_TEST, "1");
  assert.equal(env.ORCA_TEST, "2");
  assert.equal(env.PATH, "/usr/bin:/bin:/usr/sbin:/sbin");
  assert.equal(Object.prototype.hasOwnProperty.call(env, "NODE_OPTIONS"), false);
});

test("rejects hostile environment overrides", () => {
  const env = minimalEnvironment({
    PATH: "/tmp/repo/bin",
    NODE_OPTIONS: "--require /tmp/pwn.js",
    LD_PRELOAD: "/tmp/pwn.so",
    DYLD_INSERT_LIBRARIES: "/tmp/pwn.dylib",
    AGENTX_ALLOWED: "yes",
  });

  assert.equal(env.PATH, "/usr/bin:/bin:/usr/sbin:/sbin");
  assert.equal(env.AGENTX_ALLOWED, "yes");
  assert.equal(Object.prototype.hasOwnProperty.call(env, "NODE_OPTIONS"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(env, "LD_PRELOAD"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(env, "DYLD_INSERT_LIBRARIES"), false);
});
