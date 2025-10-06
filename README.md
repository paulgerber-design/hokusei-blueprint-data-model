# Hokusei Blueprint Data Model

Schemas + CLI importer for:
- `aimtable.v1`
- `hierarchy.v1`
- `plannerbundle.v1`

## Requirements
- Node ≥ 18.18 (20/22 OK)
- npm ≥ 9

## Install & Test

```bash
npm install
npm run schema:test

### Quick run
# validate schemas against examples
npm run schema:compile
npm run schema:validate

# clean imports
npm run imports:clean

# import data
cat examples/aimtable.v1.pass.json      | node importer/cli.js --mode stdin --type aimtable
cat examples/hierarchy.v1.pass.json     | node importer/cli.js --mode stdin --type hierarchy
cat examples/plannerbundle.v1.pass.json | node importer/cli.js --mode stdin --type plannerbundle

# sanity check & merge
npm run merge:dry
npm run merge
# outputs in merges/<TIMESTAMP>/...

