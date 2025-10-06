#!/usr/bin/env node
// importer/cli.js
const fs = require("fs");
const path = require("path");
const { makeAjv } = require("../lib/ajvFactory");

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
function hasFlag(flag) {
  return process.argv.includes(flag);
}

const mode = argVal("--mode", "paste"); // "stdin" | "paste"
const forcedType = argVal("--type", null); // aimtable | hierarchy | plannerbundle
const outRoot = argVal("--out-dir", "imports");

if (hasFlag("--help")) {
  console.log(`Usage:
  Paste mode:
    node importer/cli.js --mode paste
  Stdin mode:
    cat file.json | node importer/cli.js --mode stdin [--type aimtable|hierarchy|plannerbundle]
  Options:
    --out-dir <dir>  Output directory root (default: imports)
    --help           Show this help
`);
  process.exit(0);
}

const ajv = makeAjv();

// Load schemas (order matters: common first).
const commonSchema = require(path.join(__dirname, "..", "schema", "types.common.v1.schema.json"));
const aimtableSchema = require(path.join(__dirname, "..", "schema", "aimtable.v1.schema.json"));
const hierarchySchema = require(path.join(__dirname, "..", "schema", "hierarchy.v1.schema.json"));
const plannerSchema = require(path.join(__dirname, "..", "schema", "plannerbundle.v1.schema.json"));

ajv.addSchema(commonSchema);
ajv.addSchema(aimtableSchema);
ajv.addSchema(hierarchySchema);
ajv.addSchema(plannerSchema);

const validators = {
  aimtable: ajv.getSchema(aimtableSchema.$id) || ajv.compile(aimtableSchema),
  hierarchy: ajv.getSchema(hierarchySchema.$id) || ajv.compile(hierarchySchema),
  plannerbundle: ajv.getSchema(plannerSchema.$id) || ajv.compile(plannerSchema)
};

function detectType(doc) {
  const v = String(doc.version || "").toLowerCase();
  if (v.startsWith("aimtable.v1")) return "aimtable";
  if (v.startsWith("hierarchy.v1")) return "hierarchy";
  if (v.startsWith("plannerbundle.v1")) return "plannerbundle";
  return null;
}

function tsUtcCompact() {
  // 2025-10-04T23:49:33.922Z -> 20251004T234933Z
  return new Date().toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function saveOut(doc) {
  const stamp = tsUtcCompact();
  const dir = path.join(outRoot, stamp);
  fs.mkdirSync(dir, { recursive: true });
  const fname = (doc.version ? String(doc.version) : "unknown.v1") + ".import.json";
  const outPath = path.join(dir, fname);
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2));
  return outPath;
}

function printErrors(prefix, errs) {
  const list = (errs || []).map(e => {
    const loc = e.instancePath || "";
    const msg = e.message || "error";
    const params = e.params ? ` ${JSON.stringify(e.params)}` : "";
    return `  - ${loc} ${msg}${params}`;
  });
  console.error(`${prefix} (${list.length} error${list.length === 1 ? "" : "s"}):\n${list.join("\n")}`);
}

function run(doc) {
  try {
    const t = forcedType || detectType(doc);
    if (!t) {
      console.error('✖ Could not detect type from "version"; please pass --type aimtable|hierarchy|plannerbundle');
      process.exit(1);
    }
    const validate = validators[t];
    const ok = validate(doc);
    if (!ok) {
      printErrors("✖ Validation failed", validate.errors);
      process.exit(1);
    }
    const out = saveOut(doc);
    console.log(`✔ Valid ${t} JSON`);
    console.log(`→ Saved to ${out}`);
  } catch (err) {
    console.error(`✖ Unexpected error: ${err && err.stack ? err.stack : String(err)}`);
    process.exit(1);
  }
}

// read input
if (mode === "stdin") {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => (buf += chunk));
  process.stdin.on("end", () => {
    try {
      const doc = JSON.parse(buf);
      run(doc);
    } catch (e) {
      console.error(`✖ Invalid JSON: ${e.message}`);
      process.exit(1);
    }
  });
  process.stdin.resume();
} else {
  // paste mode
  console.log("Paste JSON, then press Ctrl-D to finish (Ctrl-Z on Windows).\n");
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => (buf += chunk));
  process.stdin.on("end", () => {
    if (!buf.trim()) {
      console.error("✖ Invalid JSON: no input received");
      process.exit(1);
    }
    try {
      const doc = JSON.parse(buf);
      run(doc);
    } catch (e) {
      console.error(`✖ Invalid JSON: ${e.message}`);
      process.exit(1);
    }
  });
  process.stdin.resume();
}
