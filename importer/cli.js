#!/usr/bin/env node
/**
 * Manual importer CLI (paste | stdin) with JSON Schema validation (Ajv v8 + formats).
 * Usage:
 *   blueprint-import --help
 *   blueprint-import --mode paste
 *   cat examples/plannerbundle.v1.pass.json | blueprint-import --mode stdin --type plannerbundle
 *
 * Local dev (without global link):
 *   npx . -- --help
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function printHelp() {
  console.log(`Usage:
  Paste mode (interactive):
    npm run import:paste
    blueprint-import --mode paste

  Stdin mode (from file):
    cat examples/plannerbundle.v1.pass.json | npm run import:stdin -- --type plannerbundle
    cat <yourfile.json> | blueprint-import --mode stdin --type hierarchy

Options:
  --mode paste|stdin
  --type aimtable|hierarchy|plannerbundle  (optional; will auto-detect from "version" if omitted)
  --out-dir <dir>          Output root directory (default: imports)
  --help                   Show this help`);
}

function parseArgs(argv) {
  const args = { mode: 'paste', type: null, outDir: 'imports' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') return { help: true };
    if (a === '--mode') { args.mode = argv[++i]; continue; }
    if (a === '--type') { args.type = argv[++i]; continue; }
    if (a === '--out-dir') { args.outDir = argv[++i]; continue; }
  }
  return args;
}

function loadSchemas(ajv) {
  const types = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schema', 'types.common.v1.schema.json'), 'utf8'));
  const aim = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schema', 'aimtable.v1.schema.json'), 'utf8'));
  const hier = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schema', 'hierarchy.v1.schema.json'), 'utf8'));
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schema', 'plannerbundle.v1.schema.json'), 'utf8'));
  ajv.addSchema(types);
  ajv.addSchema(aim);
  ajv.addSchema(hier);
  ajv.addSchema(plan);
}

function detectType(json) {
  if (!json || typeof json !== 'object') return null;
  switch (json.version) {
    case 'aimtable.v1': return 'aimtable';
    case 'hierarchy.v1': return 'hierarchy';
    case 'plannerbundle.v1': return 'plannerbundle';
    default: return null;
  }
}

function getSchemaRef(type) {
  if (type === 'aimtable') return { $ref: 'aimtable.v1.schema.json' };
  if (type === 'hierarchy') return { $ref: 'hierarchy.v1.schema.json' };
  if (type === 'plannerbundle') return { $ref: 'plannerbundle.v1.schema.json' };
  return null;
}

async function readPaste() {
  console.log('Paste JSON, then press Ctrl-D to finish (Ctrl-Z on Windows).\n');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  let buf = '';
  for await (const line of rl) buf += line + '\n';
  return buf.trim();
}

async function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf.trim()));
    process.stdin.on('error', (e) => reject(e));
  });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); process.exit(0); }

  if (!['paste', 'stdin'].includes(args.mode)) {
    console.error('✖ Invalid --mode (use paste|stdin)');
    process.exit(2);
  }

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  loadSchemas(ajv);

  let raw;
  try {
    raw = args.mode === 'paste' ? await readPaste() : await readStdin();
  } catch (e) {
    console.error(`✖ Read error: ${String(e)}`);
    process.exit(2);
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    console.error(`✖ Invalid JSON: ${e.message}`);
    process.exit(1);
  }

  const type = args.type || detectType(json);
  if (!type) {
    console.error('✖ Could not determine type. Pass --type aimtable|hierarchy|plannerbundle or include a valid "version".');
    process.exit(2);
  }

  const schemaRef = getSchemaRef(type);
  if (!schemaRef) {
    console.error('✖ Unknown --type value.');
    process.exit(2);
  }

  const validate = ajv.compile(schemaRef);
  const valid = validate(json);

  if (!valid) {
    console.error(`✖ Validation failed (${validate.errors.length} ${validate.errors.length === 1 ? 'error' : 'errors'}):`);
    for (const err of validate.errors) {
      console.error(`  - ${err.instancePath || '/'} ${err.message} ${JSON.stringify(err.params)}`);
    }
    process.exit(1);
  }

  console.log(`✔ Valid ${type} JSON`);

  const outRoot = path.resolve(process.cwd(), args.outDir);
  const outDir = path.join(outRoot, timestamp());
  ensureDir(outDir);
  const outFile = path.join(outDir, `${type}.v1.import.json`);
  fs.writeFileSync(outFile, JSON.stringify(json, null, 2));
  console.log(`→ Saved to ${path.relative(process.cwd(), outFile)}`);
}

main().catch((e) => {
  console.error(`✖ Unexpected error: ${String(e)}`);
  process.exit(2);
});
