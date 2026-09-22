// 指定manifest才有新驗收；每次從完整預期案例、startup、receipt及raw重算。
import path from 'node:path';
import { options, requiredManifest, verifyManifest, atomicJson, groups } from '../../../reacceptance-fixes/tools/replay-contract.mjs';
try {
  const args = options(process.argv.slice(2), ['manifest', 'group']);
  const context = requiredManifest(args);
  const selected = args.group ? [args.group] : groups;
  const summary = verifyManifest(context, selected);
  const name = args.group ? `verified-${args.group}.json` : 'verified-replays.json';
  atomicJson(path.join(context.directory, name), summary);
  const rows = Object.values(summary.groups).flatMap(group => group.cases);
  console.log(JSON.stringify({ allPassed: true, batchId: summary.batchId, manifestRevision: summary.manifestRevision, cases: rows.length, formalApp: rows.filter(row => row.formalApp).length }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
