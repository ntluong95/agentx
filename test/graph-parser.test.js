"use strict";

const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const test = require("node:test");
const os = require("os");
const path = require("path");
const { compileGraph } = require("../skills/delivery/lib/graph-compiler");
const { parseMermaid } = require("../skills/delivery/lib/graph-parser");
const { validateGraph } = require("../skills/delivery/lib/graph-validator");

function makeGitRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "agentx-graph-repo-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  return repo;
}

test("parses repository Mermaid DAG with policy directives", () => {
  const graph = parseMermaid(`
flowchart TD
%%@agentx {"maxParallel":2,"profile":"neutral"}
%%@agentx {"node":"research","agent":"codex","workspace":"shared-readonly","fallback":["claude"]}
%%@agentx {"node":"build","agent":"claude","workspace":"shared-serialized-writer"}
research["Research"] --> build["Build"]
review["Review"] --> build
`);

  assert.deepEqual(graph.edges.map((e) => [e.from, e.to]), [["research", "build"], ["review", "build"]]);
  assert.equal(graph.nodes.find((n) => n.id === "research").policy.agent, "codex");
  assert.equal(validateGraph(graph).ok, true);
});


test("supports directive targets that match object prototype property names", () => {
  const graph = parseMermaid(`
flowchart TD
%%@agentx {"node":"constructor","agent":"codex","workspace":"shared-readonly"}
%%@agentx {"node":"toString","agent":"claude","workspace":"shared-readonly"}
%%@agentx {"edge":["constructor","toString"],"gate":"approved"}
constructor["Constructor"] --> toString["To String"]
`);

  assert.equal(graph.nodes.find((n) => n.id === "constructor").policy.agent, "codex");
  assert.equal(graph.nodes.find((n) => n.id === "toString").policy.agent, "claude");
  assert.equal(graph.edges[0].policy.gate, "approved");
  assert.equal(validateGraph(graph).ok, true);
});

test("rejects cycles and generic launch fallback", () => {
  const graph = parseMermaid(`
flowchart LR
%%@agentx {"fallbackTuples":[{"errorCode":"launch_failed","failedStage":"start","effects":"none"}]}
a --> b
b --> a
`);
  const result = validateGraph(graph);

  assert.equal(result.ok, false);
  assert(result.errors.some((e) => e.includes("cycle")));
  assert(result.errors.some((e) => e.includes("launch_failed")));
});

test("rejects malformed policy schema", () => {
  const graph = parseMermaid(`
flowchart TD
%%@agentx {"fallbackTuples":{}}
%%@agentx {"node":"a","agent":{},"fallback":[null,{},7],"workspace":false,"artifacts":[null,"x",{"path":"../secret"},{"path":"C:\\\\secret.txt"},{"path":"C:secret.txt"},{"path":"\\\\secret.txt"},{"path":"\\\\\\\\server\\\\share\\\\secret.txt"}]}
a --> b
`);
  const result = validateGraph(graph);

  assert.equal(result.ok, false);
  assert(result.errors.some((e) => e.includes("fallbackTuples must be an array")));
  assert(result.errors.some((e) => e.includes("agent must be a provider id")));
  assert(result.errors.some((e) => e.includes("fallback entries must be provider ids")));
  assert(result.errors.some((e) => e.includes("unsupported workspace mode")));
  assert(result.errors.some((e) => e.includes("artifact path must be safe")));
});

test("rejects wildcard and whitespace fallback tuples", () => {
  const graph = parseMermaid(`
flowchart TD
%%@agentx {"fallbackTuples":[{"errorCode":"launch_*","failedStage":"worker-start","effects":"no-write"},{"errorCode":"quota","failedStage":" ","effects":"   "}]}
a --> b
`);
  const result = validateGraph(graph);

  assert.equal(result.ok, false);
  assert(result.errors.some((e) => e.includes("fallback tuple must include")));
});

test("rejects policy directives that target missing graph objects", () => {
  const graph = parseMermaid(`
flowchart TD
%%@agentx {"node":"missing","agent":"codex"}
a --> b
`);
  const result = validateGraph(graph);

  assert.equal(result.ok, false);
  assert(result.errors.some((e) => e.includes("unknown node missing")));
});

test("rejects duplicate dependencies", () => {
  const graph = parseMermaid(`
flowchart TD
a --> b
a --> b
`);
  const result = validateGraph(graph);

  assert.equal(result.ok, false);
  assert(result.errors.some((e) => e.includes("duplicate dependency a->b")));
});

test("rejects unknown policy keys, duplicate node labels, and disconnected nodes", () => {
  const graph = parseMermaid(`
flowchart TD
%%@agentx {"agnt":"typo","command":"rm -rf"}
%%@agentx {"node":"a","agnt":"codex"}
%%@agentx {"edge":["a","b"],"settle":true}
a["First"]
a["Second"]
a --> b
c["Disconnected"]
`);
  const result = validateGraph(graph);

  assert.equal(result.ok, false);
  assert(result.errors.some((e) => e.includes("unknown policy key agnt")));
  assert(result.errors.some((e) => e.includes("unknown policy key command")));
  assert(result.errors.some((e) => e.includes("unknown policy key settle")));
  assert(result.errors.some((e) => e.includes("duplicate node declaration a")));
  assert(result.errors.some((e) => e.includes("c: disconnected node")));
});


test("rejects unknown nested provider and communication policy keys", () => {
  const graph = parseMermaid(`
flowchart TD
%%@agentx {"providers":{"codex":{"orcaAgent":"codex","shell":"/bin/sh"}},"communication":{"routes":[{"from":"a","to":"b","type":"handoff","command":"run"}]},"approval":{"required":true,"script":"x"}}
%%@agentx {"node":"a","outcome":{"schema":"result","command":"x"}}
a --> b
`);
  const result = validateGraph(graph);

  assert.equal(result.ok, false);
  assert(result.errors.some((e) => e.includes("provider codex: unknown policy key shell")));
  assert(result.errors.some((e) => e.includes("communication route: unknown policy key command")));
  assert(result.errors.some((e) => e.includes("approval: unknown policy key script")));
  assert(result.errors.some((e) => e.includes("a: outcome: unknown policy key command")));
});


test("rejects prototype keys and duplicate JSON keys in directives", () => {
  const protoGraph = parseMermaid(`
flowchart TD
%%@agentx {"__proto__":{"profile":"software-delivery"}}
a --> b
`);
  const protoResult = validateGraph(protoGraph);

  assert.equal(protoResult.ok, false);
  assert(protoResult.errors.some((e) => e.includes("unknown policy key __proto__")));

  assert.throws(() => parseMermaid(`
flowchart TD
%%@agentx {"profile":"neutral","profile":"software-delivery"}
a --> b
`), /duplicate key profile/);
});

test("rejects unresolved hierarchy and communication references", () => {
  const graph = parseMermaid(`
flowchart TD
%%@agentx {"communication":{"routes":[{"from":"missing","to":"also_missing","type":"handoff"}]}}
%%@agentx {"node":"a","manager":"missing","subordinates":["ghost"],"communication":["nobody"]}
a --> b
`);
  const result = validateGraph(graph);

  assert.equal(result.ok, false);
  assert(result.errors.some((e) => e.includes("manager references unknown node missing")));
  assert(result.errors.some((e) => e.includes("subordinates references unknown node ghost")));
  assert(result.errors.some((e) => e.includes("communication references unknown node nobody")));
  assert(result.errors.some((e) => e.includes("communication route references unknown node missing")));
  assert(result.errors.some((e) => e.includes("communication route references unknown node also_missing")));
});

test("rejects disconnected graph components", () => {
  const graph = parseMermaid(`
flowchart TD
a --> b
c --> d
`);
  const result = validateGraph(graph);

  assert.equal(result.ok, false);
  assert(result.errors.some((e) => e.includes("disconnected components")));
});

test("rejects conflicting profile override", () => {
  const graph = parseMermaid(`
flowchart TD
%%@agentx {"profile":"neutral"}
a --> b
`);

  assert.throws(() => compileGraph(graph, { profile: "software-delivery" }), /profile override conflicts/);
});

test("compiles deterministic dependency manifest", () => {
  const graph = parseMermaid(`
flowchart TD
%%@agentx {"edge":["code","review"],"gate":"approved","handoff":true}
plan --> code
plan --> test
code --> review
test --> review
`);
  const first = compileGraph(graph);
  const second = compileGraph(graph);

  assert.equal(first.digest, second.digest);
  assert.deepEqual(first.manifest.tasks.find((t) => t.id === "review").dependsOn, ["code", "test"]);
  assert.deepEqual(first.manifest.tasks.find((t) => t.id === "review").dependencyPolicy.code, {
    gate: "approved",
    handoff: true,
  });
});

test("CLI sourcePath is relative to Git repository root", () => {
  const repo = makeGitRepo();
  const nested = path.join(repo, "workflows", "nested");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, "release.mmd"), "flowchart TD\na --> b\n");

  const out = execFileSync(process.execPath, [
    path.resolve(__dirname, "../skills/delivery/scripts/agentx.js"),
    "compile-graph",
    "--graph",
    "workflows/nested/release.mmd",
  ], { cwd: repo, encoding: "utf8" });
  const parsed = JSON.parse(out);

  assert.equal(parsed.manifest.sourcePath, "workflows/nested/release.mmd");
});


test("CLI accepts repo graphs outside the current subdirectory", () => {
  const repo = makeGitRepo();
  const nested = path.join(repo, "nested");
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(repo, "root.mmd"), "flowchart TD\na --> b\n");

  const out = execFileSync(process.execPath, [
    path.resolve(__dirname, "../skills/delivery/scripts/agentx.js"),
    "compile-graph",
    "--graph",
    "../root.mmd",
  ], { cwd: nested, encoding: "utf8" });
  const parsed = JSON.parse(out);

  assert.equal(parsed.manifest.sourcePath, "root.mmd");
});

test("CLI rejects graph commands outside a Git repository", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "agentx-not-git-"));
  fs.writeFileSync(path.join(repo, "workflow.mmd"), "flowchart TD\na --> b\n");

  assert.throws(() => execFileSync(process.execPath, [
    path.resolve(__dirname, "../skills/delivery/scripts/agentx.js"),
    "compile-graph",
    "--graph",
    "workflow.mmd",
  ], { cwd: repo, encoding: "utf8" }), (err) => String(err.stdout).includes("inside a Git repository"));
});

test("CLI rejects symlinked graph outside caller repository cwd", () => {
  const repo = makeGitRepo();
  const outside = path.join(os.tmpdir(), "outside-agentx-graph-" + process.pid + ".mmd");
  fs.writeFileSync(outside, "flowchart TD\na --> b\n");
  fs.symlinkSync(outside, path.join(repo, "linked.mmd"));

  assert.throws(() => execFileSync(process.execPath, [
    path.resolve(__dirname, "../skills/delivery/scripts/agentx.js"),
    "compile-graph",
    "--graph",
    "linked.mmd",
  ], { cwd: repo, encoding: "utf8" }), (err) => String(err.stdout).includes("inside the current repository"));
});

test("CLI accepts in-cwd graph names that begin with two dots", () => {
  const repo = makeGitRepo();
  fs.mkdirSync(path.join(repo, "..workflow"));
  fs.writeFileSync(path.join(repo, "..workflow", "valid.mmd"), "flowchart TD\na --> b\n");

  const out = execFileSync(process.execPath, [
    path.resolve(__dirname, "../skills/delivery/scripts/agentx.js"),
    "compile-graph",
    "--graph",
    "..workflow/valid.mmd",
  ], { cwd: repo, encoding: "utf8" });
  const parsed = JSON.parse(out);

  assert.equal(parsed.manifest.sourcePath, "..workflow/valid.mmd");
});
