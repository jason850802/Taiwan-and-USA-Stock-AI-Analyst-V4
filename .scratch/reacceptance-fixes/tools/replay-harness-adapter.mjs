// 原04／05的編譯分支移至listen前，保留原build選項與05固定來源plugin。
// 只轉接記憶體中的來源文字；原場景與原檔bytes不變。
import { assert } from './replay-contract.mjs';

export function adaptHarnessSource(source, ticket) {
  if (!['04', '05'].includes(ticket)) return source;
  const marker = "} else if (url.pathname === '/__fixture/holdings.js') {";
  const start = source.indexOf(marker);
  assert(start >= 0 && source.indexOf(marker, start + 1) < 0, '原harness編譯入口改變');
  const bodyStart = start + marker.length, end = source.indexOf('    } else if (', bodyStart);
  assert(end > bodyStart, '原harness編譯分支結尾改變');
  const body = source.slice(bodyStart, end);
  assert(body.split('content = bundle;').length === 2 && [...body.matchAll(/\bbuild\(/g)].length === 1, '原harness編譯輸出改變');
  const eager = body.replace('content = bundle;', "replay.captureArtifact('holdings.js', bundle);");
  source = source.slice(0, bodyStart) + "\n      throw new Error('請使用本頁版本化建置產物路徑');\n" + source.slice(end);
  const declaration = ticket === '04' ? 'let bundle;\nlet bundleHash;' : 'let bundle;';
  assert(source.split(declaration).length === 2, '原bundle宣告改變');
  source = source.replace(declaration, declaration + '\n{' + eager + '\n}\n');
  const script = '<script type="module" src="/__fixture/holdings.js"></script>';
  assert(source.split(script).length === 2, '原harness HTML入口改變');
  return source.replace(script, '<script type="module" src="\' + replay.artifactPath("holdings.js") + \'"></script>');
}
