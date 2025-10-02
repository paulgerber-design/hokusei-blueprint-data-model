#!/usr/bin/env node
/* Blueprint Importer (manual paste or stdin)
 * Supports: aimtable.v1, hierarchy.v1, plannerbundle.v1
 * Writes: imports/<ISO-compact>/<type>.v1.import.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

function showHelp() {
  console.log(`
Usage:
  Paste mode (interactive):
    npm run import:paste
    blueprint-import --mode paste

  Stdin mode (from file):
    cat examples/plannerbundle.v1.pass.json | npm run import:stdin -- --type plannerbundle
    cat <yourfile.json> | blueprint-import --mode stdin --type hierarchy

Options:
  --mode paste|stdin       Input mode (default: paste)
  --type aimtable|hierarchy|plannerbundle  (optional; auto-detected from "version" when omitted)
  --out-dir <dir>          Output root directory (default: imports)
  --help                   Show this help
`.trim());
}

function parseArgs(argv) {
  const opts = { mode: 'paste', type: null, outDir: 'imports' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') opts.mode = argv[++i] || opts.mode;
    else if (a === '--type') opts.type = argv[++i] || null;
    else if (a === '--out-dir' || a === '--dest') opts.outDir = argv[++i] || opts.outDir;
    else if (a === '--help' || a === '-h') { showHelp(); process.exit(0); }
  }
  return opts;
}

async function readFromPaste() {
  console.log('Paste JSON, then press Ctrl-D to finish (Ctrl-Z on Windows).');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let buf = '';
  for await (const line of rl) buf += line + '\n';
  return buf.trim();
}

async function readFromStdin() {
  if (process.stdin.isTTY) {
    console.error('✖ No stdin detected. Use --mode paste or pipe a file.');
    process.exit(1);
  }
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8').trim();
}

function loadSchemas() {
  const schemaDir = path.resolve(__dirname, '../schema');
  const load = (f) => JSON.parse(fs.readFileSync(path.join(schemaDir, f), 'utf8'));
  const types = load('types.common.v1.schema.json');
  const aim = load('aimtable.v1.schema.json');
  const hier = load('hierarchy.v1.schema.json');
  const plan = load('plannerbundle.v1.schema.json');

  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(types, types.$id || 'types.common.v1.schema.json');
  ajv.addSchema(aim,   aim.$id   || 'aimtable.v1.schema.json');
  ajv.addSchema(hier,  hier.$id  || 'hierarchy.v1.schema.json');
  ajv.addSchema(plan,  plan.$id  || 'plannerbundle.v1.schema.json');

  return { ajv };
}

function detectType(obj) {
  const v = obj && typeof obj.version === 'string' ? obj.version : '';
  if (v.startsWith('aimtable.')) return 'aimtable';
  if (v.startsWith('hierarchy.')) return 'hierarchy';
  if (v.startsWith('plannerbundle.')) return 'plannerbundle';
  return null;
}

function schemaIdFor(type) {
  return {
    aimtable: 'aimtable.v1.schema.json',
    hierarchy: 'hierarchy.v1.schema.json',
    plannerbundle: 'plannerbundle.v1.schema.json'
  }[type] || null;
}

function isoCompact() {
  // 2025-09-30T12:34:56.789Z -> 20250930-123456Z (remove punctuation, keep Z)
  const s = new Date().toISOString();
  return s.replace(/[-:]/g, '').replace(/\.\d{3}/, '').replace('T', '-');
}

(async function main() {
  const opts = parseArgs(process.argv);
  const input = await (opts.mode === 'stdin' ? readFromStdin() : readFromPaste());

  let data;
  try {
    data = JSON.parse(input);
  } catch (e) {
    console.error('✖ Invalid JSON:', e.message);
    process.exit(1);
  }

  let type = opts.type || detectType(data);
  if (!type) {
    console.error('✖ Could not detect type from "version". Pass --type aimtable|hierarchy|plannerbundle.');
    process.exit(1);
  }

  const { ajv } = loadSchemas();
  const sid = schemaIdFor(type);
  const validate = ajv.getSchema(sid);
  if (!validate) {
    console.error(`✖ Internal error: schema not loaded for ${type} (${sid})`);
    process.exit(1);
  }

  const valid = validate(data);
  if (!valid) {
    console.error(`✖ Validation failed (${validate.errors.length} error${validate.errors.length !== 1 ? 's' : ''}):`);
    for (const err of validate.errors) {
      console.error(`  - ${err.instancePath || '/'} ${err.message}${err.params ? ' ' + JSON.stringify(err.params) : ''}`);
    }
    process.exit(2);
  }

  const outRoot = path.resolve(process.cwd(), opts.outDir, isoCompact());
  fs.mkdirSync(outRoot, { recursive: true });
  const outFile = path.join(outRoot, `${type}.v1.import.json`);
  fs.writeFileSync(outFile, JSON.stringify(data, null, 2), 'utf8');

  console.log(`✔ Valid ${type} JSON`);
  console.log(`→ Saved to ${path.relative(process.cwd(), outFile)}`);
  process.exit(0);
})();
