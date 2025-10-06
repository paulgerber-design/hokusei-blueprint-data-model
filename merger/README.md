# Hokusei Merger (S30)

Merges imports/ into a canonical blueprint + report.

## Commands

- `npm run merge:dry` – show report in stdout, write nothing
- `npm run merge` – write to `merges/<timestamp>/...`
- `npm run merge:examples` – import examples and then merge

## Strategy

Default `latest-wins` by import folder timestamp. Use `--strategy first-wins` to prefer oldest.

## Reports

- `blueprint.merge.json` – AimTable winner, Hierarchy winner, all valid PlannerBundles, plus indexes
- `blueprint.merge.report.json` – counts, validation errors, cross-ref issues
- `report.md` – human summary

Exit code is `0` on clean merge, `2` if top-level errors exist (e.g., missing AimTable).
