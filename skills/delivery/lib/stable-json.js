"use strict";

function stable(value) {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stable);
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
  return out;
}

function stringify(value) {
  return JSON.stringify(stable(value));
}

module.exports = { stable, stringify };
