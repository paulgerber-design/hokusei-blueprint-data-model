#!/usr/bin/env node
'use strict';

/*
  Hokusei Blueprint Merger (minimal/safe version)

  What it does (and only this):
  - Scans JSON files one level deep under: imports/<stamp>/*.json
  - Detects three import kinds by filename or embedded `version`:
      * aimtable       -> collects Aim IDs
      * hierarchy      -> collects Micro IDs (and keeps the latest hierarchy seen)
      * plannerbundle  -> aggregates planners and performs best-effort reference checks
  - Produces, unless --dry-run:
      merges/<ISOstamp>/blueprint.merge.json
      merges/<ISOstamp>/blueprint.merge.report.json
      merges/<ISOstamp>/report.md

  Notes:
  - No AJV usage here (the importer already validated). This keeps us away from
    meta-schema differences and preserves your current working state.
  - Reference checks are best-effort: we warn when planner callouts reference
    unknown aimIds or when DOD.includesMicros reference unknown microIds.
*/

const fs = require('fs');
const path = require('path');

// ---------- small fs helpers ----------
function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
function listImportJsonFiles(root) {
  const out = [];
  if (!isDir(root)) return out;

  for (const dirent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const sub = path.join(root, dirent.name);
    for (const f of fs.readdirSync(sub, { withFileTypes: true })) {
      if (f.isFile() && f.name.toLowerCase().endsWith('.json')) {
        out.push(path.join(sub, f.name));
      }
    }
  }
  return out.sort();
}
function readJson(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return [JSON.parse(raw), null];
  } catch (err) {
    return [null, `Failed to parse ${path.relative(process.cwd(), file)}: ${err.message}`];
  }
}
function kindFromFilename(file) {
  const base = path.basename(file).toLowerCase();
  if (base.includes('aimtable')) return 'aimtable';
  if (base.includes('hierarchy')) return 'hierarchy';
  if (base.includes('plannerbundle')) return 'plannerbundle';
  return 'unknown';
}
function isoStampForDir(d = new Date()) {
  // e.g. 20251005T013654Z
  const s = d.toISOString().replace(/\.\d+Z$/, 'Z').replace(/[:-]/g, '');
  return s;
}

// ---------- merge core ----------
function mergeAll(files) {
  const aimIds = new Set();
  const microIds = new Set();
  const refIssues = [];
  const errors = [];

  const aimsMap = {};   // id -> item (first one wins)
  let hierarchy = null; // keep latest seen
  const planners = [];  // array of plannerbundle payloads with {source,...}

  for (const file of files) {
    const [data, err] = readJson(file);
    if (err) { errors.push(err); continue; }

    const version = data && typeof data.version === 'string' ? data.version.toLowerCase() : '';
    const inferredKind =
      version.includes('aimtable') ? 'aimtable' :
      version.includes('hierarchy') ? 'hierarchy' :
      version.includes('plannerbundle') ? 'plannerbundle' :
      kindFromFilename(file);

    if (inferredKind === 'aimtable') {
      // Collect aims
      if (data && Array.isArray(data.items)) {
        for (const item of data.items) {
          if (item && typeof item === 'object' && typeof item.id === 'string') {
            if (!aimsMap[item.id]) aimsMap[item.id] = item;
            aimIds.add(item.id);
          }
        }
      }
    } else if (inferredKind === 'hierarchy') {
      // Keep the latest hierarchy and collect micro IDs
      hierarchy = data;
      if (data && Array.isArray(data.pillars)) {
        for (const pillar of data.pillars) {
          if (!pillar || !Array.isArray(pillar.subs)) continue;
          for (const sub of pillar.subs) {
            if (!sub || !Array.isArray(sub.micros)) continue;
            for (const micro of sub.micros) {
              if (micro && typeof micro.id === 'string') {
                microIds.add(micro.id);
              }
            }
          }
        }
      }
    } else if (inferredKind === 'plannerbundle') {
      // Keep full planner for output and do best-effort reference checks
      planners.push({ source: path.basename(file), ...data });

      try {
        const projects = Array.isArray(data.projects) ? data.projects : [];
        projects.forEach((proj, pIdx) => {
          const pathsArr = Array.isArray(proj.paths) ? proj.paths : [];
          pathsArr.forEach((pth, pathIdx) => {
            const slices = Array.isArray(pth.slices) ? pth.slices : [];
            slices.forEach((sl, sIdx) => {
              const callouts = sl && sl.callouts ? sl.callouts : {};
              const pos = Array.isArray(callouts.positiveEffects) ? callouts.positiveEffects : [];
              const neg = Array.isArray(callouts.negativeEffects) ? callouts.negativeEffects : [];
              [...pos, ...neg].forEach((co, cIdx) => {
                const aimId = co && co.aimId;
                if (typeof aimId === 'string' && !aimIds.has(aimId)) {
                  refIssues.push({
                    type: 'aimId-not-found',
                    aimId,
                    file: path.basename(file),
                    project: proj.name || proj.id || `#${pIdx}`,
                    path: pth.name || `#${pathIdx}`,
                    slice: sl.name || `#${sIdx}`,
                    index: cIdx,
                    at: `projects[${pIdx}].paths[${pathIdx}].slices[${sIdx}]`
                  });
                }
              });

              const dod = sl && sl.dod;
              const includeMicros = dod && Array.isArray(dod.includesMicros) ? dod.includesMicros : [];
              includeMicros.forEach((mid, mIdx) => {
                if (typeof mid === 'string' && !microIds.has(mid)) {
                  refIssues.push({
                    type: 'microId-not-found',
                    microId: mid,
                    file: path.basename(file),
                    project: proj.name || proj.id || `#${pIdx}`,
                    path: pth.name || `#${pathIdx}`,
                    slice: sl.name || `#${sIdx}`,
                    index: mIdx,
                    at: `projects[${pIdx}].paths[${pathIdx}].slices[${sIdx}].dod.includesMicros[${mIdx}]`
                  });
                }
              });
            });
          });
        });
      } catch (e) {
        errors.push(`Ref-check crashed on ${path.basename(file)}: ${e.message}`);
      }
    } else {
      errors.push(`Skipped unrecognized import: ${path.relative(process.cwd(), file)}`);
    }
  }

  const timestamp = isoStampForDir();
  const outRoot = path.join(process.cwd(), 'merges', timestamp);

  const report = {
    version: 'blueprint.merge.report.v1',
    mergedAt: new Date().toISOString(),
    counts: {
      importsTotal: files.length,
      plannersTotal: planners.length,
      plannersValid: planners.length,    // trusting importer validation
      aimIds: aimIds.size,
      microIds: microIds.size,
      refIssues: refIssues.length
    },
    errors,
    invalidPlanners: [],                 // reserved for stricter validation later
    refIssues
  };

  const merged = {
    version: 'blueprint.merge.v1',
    mergedAt: new Date().toISOString(),
    sources: files.map(f => path.relative(process.cwd(), f)),
    aims: Object.values(aimsMap),
    hierarchy,
    planners
  };

  return { report, merged, outRoot };
}

function writeOutputs(outRoot, { report, merged }) {
  fs.mkdirSync(outRoot, { recursive: true });

  const mergeJsonPath = path.join(outRoot, 'blueprint.merge.json');
  const reportJsonPath = path.join(outRoot, 'blueprint.merge.report.json');
  fs.writeFileSync(mergeJsonPath, JSON.stringify(merged, null, 2));
  fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2));

  const md = [
    '# Hokusei Blueprint — Merge Report',
    '',
    `**Merged at:** ${report.mergedAt}`,
    '',
    '## Counts',
    `- Imports: ${report.counts.importsTotal}`,
    `- Planner bundles: ${report.counts.plannersTotal} (valid: ${report.counts.plannersValid})`,
    `- Aim IDs: ${report.counts.aimIds}`,
    `- Micro IDs: ${report.counts.microIds}`,
    `- Reference issues: ${report.counts.refIssues}`,
    '',
    report.errors.length ? '## Errors' : '',
    ...report.errors.map(e => `- ${e}`),
    '',
    report.refIssues.length ? '## Reference issues' : '',
    ...report.refIssues.map(ri =>
      `- [${ri.type}] ${ri.file} → ${ri.at}` +
      (ri.aimId ? ` (aimId: ${ri.aimId})` : ri.microId ? ` (microId: ${ri.microId})` : '')
    ),
    ''
  ].filter(Boolean).join('\n');

  const mdPath = path.join(outRoot, 'report.md');
  fs.writeFileSync(mdPath, md);

  return { mergeJsonPath, reportJsonPath, reportMdPath: mdPath };
}

// ---------- CLI ----------
async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const importsRoot = path.join(process.cwd(), 'imports');
  const files = listImportJsonFiles(importsRoot);

  if (files.length === 0) {
    console.error('No imports found under imports/<stamp>/*.json. Run the importer first.');
    process.exitCode = 1;
    return;
  }

  const result = mergeAll(files);

  if (dryRun) {
    console.log('— Dry run —');
    console.log(JSON.stringify(result.report, null, 2));
    return;
  }

  const paths = writeOutputs(result.outRoot, result);
  console.log('✔ Merge complete');
  console.log(`→ ${path.relative(process.cwd(), paths.mergeJsonPath)}`);
  console.log(`→ ${path.relative(process.cwd(), paths.reportJsonPath)}`);
  console.log(`→ ${path.relative(process.cwd(), paths.reportMdPath)}`);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
