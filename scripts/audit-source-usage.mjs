// 靜態掃描正式程式的本地模組可達性；不可達只代表候選，不自動刪檔。
import ts from 'typescript';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const normalize = file => path.resolve(file).replaceAll('\\', '/');
const root = normalize(process.cwd());
const sources = parsed.fileNames.map(normalize).filter(file => {
  const relative = file.slice(root.length + 1);
  return /^(?:App\.tsx|index\.tsx|types\.ts|(?:api|services|utils|components|config)\/.*\.tsx?)$/.test(relative)
    && !/\.test\.tsx?$/.test(file);
});
const sourceSet = new Set(sources);
const graph = new Map(sources.map(file => {
  const imports = ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles;
  const resolved = imports.map(ref => ts.resolveModuleName(ref.fileName, file, parsed.options, ts.sys).resolvedModule?.resolvedFileName)
    .filter(Boolean).map(normalize).filter(file => sourceSet.has(file));
  return [file, resolved];
}));
const entrypoints = sources.filter(file => file === `${root}/index.tsx` || (/\/api\//.test(file) && !/\/api\/_lib\//.test(file)));
const reachable = new Set();
const visit = file => {
  if (reachable.has(file)) return;
  reachable.add(file);
  for (const dependency of graph.get(file) ?? []) visit(dependency);
};
entrypoints.forEach(visit);
console.log(JSON.stringify({
  sourceFiles: sources.length,
  reachableFiles: reachable.size,
  entrypoints: entrypoints.map(file => file.slice(root.length + 1)),
  unreachableCandidates: sources.filter(file => !reachable.has(file)).map(file => file.slice(root.length + 1)),
  files: sources.map(file => ({ path: file.slice(root.length + 1), lines: readFileSync(file, 'utf8').split('\n').length, reachable: reachable.has(file) })),
}, null, 2));
