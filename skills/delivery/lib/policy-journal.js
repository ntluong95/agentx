"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { stringify } = require("./stable-json");

function ensurePrivateDir(dir) {
  let existed = true;
  try {
    const st = fs.statSync(dir);
    if (!st.isDirectory()) throw new Error(dir + " is not a directory");
  } catch (e) {
    if (e && e.code !== "ENOENT") throw e;
    existed = false;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const st = fs.statSync(dir);
  const mode = st.mode & 0o777;
  if (!existed) {
    fs.chmodSync(dir, 0o700);
    return;
  }
  if ((mode & 0o077) !== 0) {
    throw new Error("journal directory must be private (0700): " + dir);
  }
}

function writeJournal(file, record) {
  const dir = path.dirname(file);
  ensurePrivateDir(dir);
  const payload = Object.assign({}, record, {
    checksum: checksum(Object.assign({}, record, { checksum: undefined })),
  });
  const data = stringify(payload) + "\n";
  const tmp = path.join(dir, "." + path.basename(file) + "." + process.pid + ".tmp");
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, data, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
  const dirFd = fs.openSync(dir, "r");
  try {
    fs.fsyncSync(dirFd);
  } finally {
    fs.closeSync(dirFd);
  }
  return payload;
}

function readJournal(file) {
  ensurePrivateDir(path.dirname(file));
  const st = fs.lstatSync(file);
  if (st.isSymbolicLink()) throw new Error("journal must not be a symlink");
  if ((st.mode & 0o077) !== 0) throw new Error("journal file must be private (0600): " + file);
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  const actual = payload.checksum;
  const expected = checksum(Object.assign({}, payload, { checksum: undefined }));
  if (actual !== expected) throw new Error("journal checksum mismatch");
  return payload;
}

function checksum(value) {
  return crypto.createHash("sha256").update(stringify(value)).digest("hex");
}

module.exports = { writeJournal, readJournal, checksum };
