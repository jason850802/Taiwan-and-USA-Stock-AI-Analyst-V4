// 批次定義固定；完整執行由操作者明確選定，沒有「最新一輪」捷徑。
import { createBatch, selectRun, options, assert } from './replay-contract.mjs';
try {
  const action = process.argv[2], args = options(process.argv.slice(3), ['label', 'baseline-gate', 'protection', 'manifest', 'group', 'run']);
  if (action === 'init') {
    assert(args.label && args['baseline-gate'] && args.protection && Object.keys(args).length === 3, 'init須指定 --label <名稱> --baseline-gate <真實基準gate.json> --protection <原工作樹保護清單>');
    console.log(JSON.stringify({ manifest: createBatch(args.label, args['baseline-gate'], args.protection) }));
  } else if (action === 'select') {
    assert(args.manifest && args.group && args.run && Object.keys(args).length === 3, 'select須指定 --manifest <M> --group <02|03|04|05-before|05-after> --run <runId>');
    console.log(JSON.stringify(selectRun(args.manifest, args.group, args.run)));
  } else throw new Error('請用init建立批次，或select明確選定完整run；詳tools/README.md');
} catch (error) { console.error(error.message); process.exitCode = 1; }
