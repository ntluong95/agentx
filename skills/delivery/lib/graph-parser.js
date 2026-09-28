"use strict";

const ID_RE = /^[A-Za-z][A-Za-z0-9_-]*/;
const EDGE_RE = /^(.+?)\s*-->\s*(.+)$/;
const DIRECTIVE_RE = /^%%\s*@agentx\s+(.+)$/;
const GRAPH_RE = /^(?:flowchart|graph)\s+(?:TD|TB|BT|RL|LR)$/;

function fail(line, message) {
  const err = new Error(line + ": " + message);
  err.line = line;
  return err;
}

function parseNode(raw, line) {
  const text = raw.trim();
  const id = ID_RE.exec(text);
  if (!id) throw fail(line, "unsupported node syntax: " + text);
  const rest = text.slice(id[0].length).trim();
  if (!rest) return { id: id[0], label: null };
  const pair = { "[": "]", "(": ")", "{": "}" }[rest[0]];
  if (!pair || rest[rest.length - 1] !== pair) throw fail(line, "unsupported node syntax: " + text);
  const inner = rest.slice(1, -1).trim();
  if (!(inner[0] === '"' && inner[inner.length - 1] === '"')) throw fail(line, "node labels must be quoted");
  return { id: id[0], label: inner.slice(1, -1) };
}

function parseDirective(raw, line) {
  try {
    rejectDuplicateJsonKeys(raw);
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch (e) {
    throw fail(line, "invalid @agentx JSON: " + (e.message || e));
  }
}

function rejectDuplicateJsonKeys(raw) {
  const stack = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (/\s/.test(ch) || ch === ":") continue;
    if (ch === "{") {
      stack.push({ type: "object", keys: new Set(), expectKey: true });
      continue;
    }
    if (ch === "[") {
      stack.push({ type: "array" });
      continue;
    }
    if (ch === "}" || ch === "]") {
      stack.pop();
      continue;
    }
    if (ch === ",") {
      const top = stack[stack.length - 1];
      if (top && top.type === "object") top.expectKey = true;
      continue;
    }
    if (ch !== "\"") continue;
    const start = i;
    let escaped = false;
    for (i++; i < raw.length; i++) {
      const c = raw[i];
      if (escaped) {
        escaped = false;
      } else if (c === "\\") {
        escaped = true;
      } else if (c === "\"") {
        break;
      }
    }
    const top = stack[stack.length - 1];
    let j = i + 1;
    while (j < raw.length && /\s/.test(raw[j])) j++;
    if (top && top.type === "object" && top.expectKey && raw[j] === ":") {
      const key = JSON.parse(raw.slice(start, i + 1));
      if (top.keys.has(key)) throw new Error("duplicate key " + key);
      top.keys.add(key);
      top.expectKey = false;
    }
  }
}

function attachDirective(target, directive, line) {
  if (directive.node) {
    appendDirective(target.nodeDirectives, directive.node, { line, value: directive });
  } else if (directive.edge) {
    if (!Array.isArray(directive.edge) || directive.edge.length !== 2) {
      throw fail(line, "edge directive must name [from,to]");
    }
    appendDirective(target.edgeDirectives, directive.edge.join("->"), { line, value: directive });
  } else {
    target.policyDirectives.push({ line, value: directive });
  }
}

function appendDirective(map, key, value) {
  const existing = map.get(key) || [];
  existing.push(value);
  map.set(key, existing);
}

function parseMermaid(source, sourcePath) {
  const lines = String(source || "").split(/\r?\n/);
  const nodes = new Map();
  const edges = [];
  const diagnostics = [];
  const directives = { nodeDirectives: new Map(), edgeDirectives: new Map(), policyDirectives: [] };
  let sawGraph = false;

  lines.forEach((raw, idx) => {
    const line = idx + 1;
    const text = raw.trim();
    if (!text) return;
    const directive = DIRECTIVE_RE.exec(text);
    if (directive) return attachDirective(directives, parseDirective(directive[1], line), line);
    if (text.startsWith("%%")) return;
    if (!sawGraph) {
      if (!GRAPH_RE.test(text)) throw fail(line, "expected Mermaid flowchart/graph header");
      sawGraph = true;
      return;
    }
    const edge = EDGE_RE.exec(text);
    if (edge) {
      const from = parseNode(edge[1], line);
      const to = parseNode(edge[2], line);
      for (const node of [from, to]) {
        const existing = nodes.get(node.id);
        if (existing && node.label && existing.label !== node.label) diagnostics.push(line + ": duplicate node declaration " + node.id);
        nodes.set(node.id, { id: node.id, label: node.label || (existing && existing.label) || node.id, line });
      }
      edges.push({ from: from.id, to: to.id, line });
      return;
    }
    const node = parseNode(text, line);
    const existing = nodes.get(node.id);
    if (existing && node.label && existing.label !== node.label) diagnostics.push(line + ": duplicate node declaration " + node.id);
    nodes.set(node.id, { id: node.id, label: node.label || (existing && existing.label) || node.id, line });
  });

  if (!sawGraph) throw fail(1, "missing Mermaid flowchart/graph header");
  const graph = applyDirectives({ sourcePath: sourcePath || null, nodes: [...nodes.values()], edges }, directives);
  graph.diagnostics = diagnostics.concat(graph.diagnostics || []);
  return graph;
}

function applyDirectives(graph, directives) {
  const diagnostics = [];
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const edgeIds = new Set(graph.edges.map((e) => e.from + "->" + e.to));
  for (const node of graph.nodes) {
    const items = directives.nodeDirectives.get(node.id) || [];
    node.policy = mergePolicies(items.map((x) => withoutKeys(x.value, ["node"])));
  }
  for (const edge of graph.edges) {
    const items = directives.edgeDirectives.get(edge.from + "->" + edge.to) || [];
    edge.policy = mergePolicies(items.map((x) => withoutKeys(x.value, ["edge"])));
  }
  for (const id of directives.nodeDirectives.keys()) {
    if (!nodeIds.has(id)) diagnostics.push("directive references unknown node " + id);
  }
  for (const id of directives.edgeDirectives.keys()) {
    if (!edgeIds.has(id)) diagnostics.push("directive references unknown edge " + id);
  }
  graph.policy = mergePolicies(directives.policyDirectives.map((x) => x.value));
  graph.diagnostics = diagnostics;
  return graph;
}

function mergePolicies(values) {
  const out = {};
  for (const value of values) {
    for (const [key, item] of Object.entries(value || {})) {
      Object.defineProperty(out, key, { value: item, enumerable: true, configurable: true, writable: true });
    }
  }
  return out;
}

function withoutKeys(value, keys) {
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (!keys.includes(k)) Object.defineProperty(out, k, { value: v, enumerable: true, configurable: true, writable: true });
  }
  return out;
}

module.exports = { parseMermaid };
