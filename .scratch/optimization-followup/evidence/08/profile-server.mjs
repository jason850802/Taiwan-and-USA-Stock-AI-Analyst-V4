// 量測專用編譯：只在記憶體中的副本加入計時及 Map 聚合觀測，不改正式原始碼。
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const dir = fileURLToPath(new URL('./', import.meta.url));
const ticket = process.argv[2] || '08';
if (!['08', '12'].includes(ticket)) throw new Error('量測輸出只接受 08、12');
const outputDir = path.join(root, '.scratch/optimization-followup/evidence', ticket);
await mkdir(outputDir, { recursive: true });
const origin = 'http://127.0.0.1:4180';
const sha = data => createHash('sha256').update(data).digest('hex');
const sourcePaths = ['services/yahoo.ts', 'services/quoteCache.ts', 'services/finmind.ts', 'services/_shared/boundedSession.ts'];
const sources = Object.fromEntries(await Promise.all(sourcePaths.map(async file => [file, await readFile(path.join(root, file), 'utf8')])));
const sourceHashes = Object.fromEntries(sourcePaths.map(file => [file, sha(sources[file])]));
const baseline = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const compiled = await build({ entryPoints: [path.join(dir, 'profile.mjs')], bundle: true, write: false,
  format: 'iife', platform: 'browser', target: 'es2022', metafile: true, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'cache-profile-observer', setup(context) {
    context.onLoad({ filter: /[\\/]services[\\/](yahoo|quoteCache|finmind|_shared[\\/]boundedSession)\.ts$/ }, args => {
      const relative = path.relative(root, args.path).replaceAll('\\', '/');
      let contents = sources[relative];
      if (relative === 'services/quoteCache.ts') {
        if (!contents.includes('const memCache =')) throw new Error('行情 Map 觀測點已變更，需更新量測介接');
        contents += '\nglobalThis.__cacheProbe.register("quote", memCache);\nglobalThis.__cacheProbe.registerIndex("quote", payloadLru);\n';
      } else if (relative === 'services/finmind.ts') {
        if (!contents.includes('const memoryCache =')) throw new Error('基本面 Map 觀測點已變更，需更新量測介接');
        contents += '\nglobalThis.__cacheProbe.register("fundamentals", memoryCache);\nglobalThis.__cacheProbe.registerIndex("fundamentals", memoryLru);\n';
      } else if (relative === 'services/_shared/boundedSession.ts') {
        const marker = '  return { read, write, remove, removeWhere };';
        if (contents.split(marker).length !== 2) throw new Error('session 索引觀測點改變');
        contents = contents.replace(marker, '  globalThis.__cacheProbe.registerSessionIndex(options.prefix, lru);\n' + marker);
      } else {
        for (const name of ['processYahooResult', 'enrichChartData']) {
          const declaration = `const ${name} = (`;
          if (contents.split(declaration).length !== 2) throw new Error(`轉換計時介接失效：${name}`);
          contents = contents.replace(declaration, `const measured_${name} = (`);
          contents += `\nconst ${name} = (...args: Parameters<typeof measured_${name}>) => globalThis.__cacheProbe.time('${name}', () => measured_${name}(...args));\n`;
        }
      }
      return { contents, loader: 'ts', resolveDir: path.dirname(args.path) };
    });
  } }],
});
const bundle = compiled.outputFiles[0].contents;
// 新增的小型儲存責任也必須綁定，不能只指紋化原來的三個服務。
for (const input of Object.keys(compiled.metafile.inputs)) {
  const file = path.resolve(input);
  const relative = path.relative(root, file).replaceAll('\\', '/');
  if (/^(services|utils)\//.test(relative)) sourceHashes[relative] = sha(await readFile(file));
}
const instrumentationHashes = Object.fromEntries(await Promise.all(['bootstrap.js', '../07/fixtures.mjs', '../07/capacity-decision.json', 'profile.mjs', 'profile-server.mjs'].map(async name => [name, sha(await readFile(path.join(dir, name)))])));
const fingerprint = { baseline, sourceHashes, instrumentationHashes, probeBundleSha256: sha(bundle), node: process.version };
const html = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>快取量測</title><script src="/bootstrap.js"></script></head><body><main><h1>隔離快取壓力量測</h1><output id="status">載入中</output><pre id="readings"></pre></main><script src="/probe.js"></script></body></html>';
const server = createServer(async (req, res) => {
  const json = (data, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  try {
    const url = new URL(req.url, origin);
    if (req.headers.host !== '127.0.0.1:4180' || (req.headers.origin && req.headers.origin !== origin)) return json({ error: '非量測來源' }, 403);
    if (url.pathname === '/__fixture/meta') return json(fingerprint);
    if (url.pathname === '/__fixture/result' && req.method === 'POST') {
      let text = '';
      for await (const chunk of req) { text += chunk; if (text.length > 32 * 1024 * 1024) throw new Error('結果過大'); }
      const data = JSON.parse(text);
      if (!/^(profile|faults)-(30|100)-[0-6]$/.test(data.name)) return json({ error: '結果名稱錯誤' }, 400);
      await writeFile(path.join(outputDir, `${data.name}.json`), JSON.stringify({ ...data.result, ...fingerprint }, null, 2) + '\n', 'utf8');
      return json({ saved: data.name });
    }
    if (url.pathname.startsWith('/api')) return json({ error: '量測 API 必須由瀏覽器假 fetch 攔截；禁止轉送' }, 403);
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const content = url.pathname === '/probe.js' ? bundle : url.pathname === '/bootstrap.js' ? await readFile(path.join(dir, 'bootstrap.js')) : url.pathname === '/' ? html : null;
    if (content === null) return json({ error: '未知量測資源' }, 404);
    res.writeHead(200, { 'Content-Type': url.pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
      'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'" });
    res.end(content);
  } catch (error) { json({ error: String(error.message) }, 500); }
});
server.listen(4180, '127.0.0.1', () => console.log(JSON.stringify({ origin, ticket, pid: process.pid, ...fingerprint })));
