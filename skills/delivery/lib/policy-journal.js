"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { stringify } = require("./stable-json");

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
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
