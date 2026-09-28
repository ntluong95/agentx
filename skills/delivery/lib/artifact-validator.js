"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function validateArtifact(root, descriptor, options) {
  const maxBytes = (options && options.maxBytes) || 10 * 1024 * 1024;
  const file = safePath(root, descriptor.path);
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(file, flags);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile()) throw new Error("artifact is not a regular file");
    const data = readBounded(fd, maxBytes);
    const after = fs.fstatSync(fd);
    if (!after.isFile()) throw new Error("artifact is not a regular file");
    if (after.size !== data.length) throw new Error("artifact changed while reading");
    if (descriptor.size != null && descriptor.size !== data.length) throw new Error("artifact size mismatch");
    const digest = crypto.createHash("sha256").update(data).digest("hex");
    if (descriptor.digest && descriptor.digest !== digest) throw new Error("artifact digest mismatch");
    return { path: descriptor.path, size: data.length, digest };
  } finally {
    fs.closeSync(fd);
  }
}

function readBounded(fd, maxBytes) {
  const chunks = [];
  let total = 0;
  for (;;) {
    const buf = Buffer.alloc(Math.min(65536, maxBytes + 1 - total));
    const n = fs.readSync(fd, buf, 0, buf.length, null);
    if (n === 0) break;
    total += n;
    if (total > maxBytes) throw new Error("artifact exceeds size limit");
    chunks.push(buf.subarray(0, n));
  }
  return Buffer.concat(chunks, total);
}

function safePath(root, rel) {
  if (typeof rel !== "string" || !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) throw new Error("unsafe artifact path");
  const realRoot = fs.realpathSync(root);
  const candidate = path.resolve(realRoot, rel);
  const dir = fs.realpathSync(path.dirname(candidate));
  if (dir !== realRoot && !dir.startsWith(realRoot + path.sep)) throw new Error("artifact escapes root");
  return path.join(dir, path.basename(candidate));
}

module.exports = { safePath, validateArtifact };
