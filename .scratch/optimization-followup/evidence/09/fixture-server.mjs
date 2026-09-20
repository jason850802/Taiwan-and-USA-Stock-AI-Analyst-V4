// 正式App整合與相同React Profiler配置的前後量測；測試資料不傳往任何真實提供商。
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { reportFor } from './report.mjs';
import { chart, finmind } from '../07/fixtures.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const dir = fileURLToPath(new URL('./', import.meta.url));
const outputTicket = process.argv[2] || '09';
if (!['09', '12'].includes(outputTicket)) throw new Error('結果只存09或12');
const output = path.join(root, '.scratch/optimization-followup/evidence', outputTicket);
await mkdir(output, { recursive: true });
const baseline = '06aa1cc8268479b8227269519c794be6a47a4f0d';
const origin = 'http://127.0.0.1:4182';
const dist = path.join(root, 'dist');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceList = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).trim().split('\n'))]
  .filter(file => /^(services|components|utils|api)\/.*\.tsx?$/.test(file) && !file.includes('.test.') || ['App.tsx', 'index.tsx', 'types.ts', 'vite.config.ts'].includes(file));
const sourceHashes = Object.fromEntries(await Promise.all(sourceList.map(async file => [file, hash(await readFile(path.join(root, file)))])));
const buildIndexSha256 = hash(await readFile(path.join(dist, 'index.html')));
const buildModified = (await stat(path.join(dist, 'index.html'))).mtimeMs;
if ((await Promise.all(sourceList.map(async file => (await stat(path.join(root, file))).mtimeMs))).some(time => time > buildModified)) {
  throw new Error('正式dist比候選原始碼舊，先執行完整gate再啟動驗收');
}
const toolHashes = Object.fromEntries(await Promise.all(['fixture-server.mjs', 'bootstrap.js', 'profile-entry.jsx', 'browser-cases.mjs', 'report.mjs', '../07/fixtures.mjs'].map(async file => [file, hash(await readFile(path.join(dir, file)))])));
const edgeToolHash = hash(await readFile(path.join(dir, 'edge-cases.mjs')));
const bundles = {}, profileBindings = {};
for (const version of ['before', 'after']) {
  const usedHashes = {};
  const compiled = await build({ absWorkingDir: root, entryPoints: [path.join(dir, 'profile-entry.jsx')], bundle: true, write: false,
    format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic', define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'readonly-profiler', setup(context) {
      context.onLoad({ filter: /\.(ts|tsx)$/ }, async args => {
        if (args.path.includes('node_modules')) return;
        const relative = path.relative(root, args.path).replaceAll('\\', '/');
        let contents = version === 'before' && ['App.tsx', 'components/portfolio/useHealthCheck.ts'].includes(relative)
          ? execFileSync('git', ['show', `${baseline}:${relative}`], { cwd: root, encoding: 'utf8' }) : await readFile(args.path, 'utf8');
        usedHashes[relative] = hash(contents);
        if (relative === 'components/ui/MarkdownReport.tsx') {
          const marker = 'export default MarkdownReport;';
          if (contents.split(marker).length !== 2) throw new Error('Markdown公開觀測點改變');
          contents = contents.replace(marker, 'const ObservedMarkdown = (props: { content: string }) => <React.Profiler id="markdown" onRender={(_, phase, duration) => globalThis.streamFixture?.render(props.content, duration, phase)}><MarkdownReport {...props} /></React.Profiler>;\nexport default ObservedMarkdown;');
        }
        return { contents, loader: args.path.endsWith('tsx') ? 'tsx' : 'ts', resolveDir: path.dirname(args.path) };
      });
    } }],
  });
  bundles[version] = compiled.outputFiles[0].contents;
  profileBindings[version] = { version, sourceHashes: usedHashes, profileBundleSha256: hash(bundles[version]), reactMode: 'development + public React.Profiler' };
}
let requests = [];
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (req.headers.host !== '127.0.0.1:4182' || (req.headers.origin && req.headers.origin !== origin)) return json(res, {}, 403);
    if (url.pathname === '/__fixture/state') return json(res, { requests });
    if (url.pathname === '/__fixture/reset' && req.method === 'POST') { requests = []; return json(res, { ok: true }); }
    if (url.pathname === '/__fixture/result' && req.method === 'POST') {
      let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 5 * 1024 * 1024) throw new Error('結果過大'); }
      const data = JSON.parse(text);
      if (!/^(before|after|app)-[a-z-]+-\d+$/.test(data.name)) throw new Error('結果名稱錯誤');
      const binding = data.result.profile ? profileBindings[data.result.version] : { sourceHashes, buildIndexSha256 };
      const usedToolHashes = data.result.kind === 'edge' ? { ...toolHashes, 'edge-cases.mjs': edgeToolHash } : toolHashes;
      await writeFile(path.join(output, `${data.name}.json`), JSON.stringify({ ...data.result, baseline, ...binding, toolHashes: usedToolHashes, requests, node: process.version }, null, 2) + '\n');
      return json(res, { saved: data.name });
    }
    if (url.pathname === '/api/gemini-stream') {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 1024 * 1024) throw new Error('假AI請求過大'); }
      const payload = JSON.parse(body);
      const mode = url.searchParams.get('mode') || 'full';
      const tag = (url.searchParams.get('tag') || 'PRIMARY').replace(/[^A-Z0-9-]/g, '');
      const report = reportFor(tag);
      const chunks = ['empty', 'error'].includes(mode) ? [] : mode === 'single' ? [report.text] : mode === 'slow' ? report.chunks.slice(0, 12) : mode === 'partial-error' ? report.chunks.slice(0, 40) : report.chunks;
      const finalText = mode === 'empty' ? '' : mode === 'slow' ? chunks.join('') : report.text;
      const events = chunks.map(text => ({ t: 'delta', text }));
      events.push(['partial-error', 'error'].includes(mode) ? { t: 'error', message: '合成串流中斷' } : { t: 'done', text: finalText });
      requests.push({ path: url.pathname, tag, mode, deltas: chunks.length, payloadHash: hash(body), finalHash: hash(finalText), modeRequested: payload.mode });
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
      res.end(events.map(event => JSON.stringify(event)).join('\n') + '\n'); return;
    }
    if (url.pathname === '/api/yahoo/chart') {
      const symbol = url.searchParams.get('symbol'), interval = url.searchParams.get('interval'), range = url.searchParams.get('range');
      requests.push({ path: url.pathname, symbol, interval, range });
      return json(res, chart(symbol, interval, range === '5d' ? 5 : 80));
    }
    if (url.pathname === '/api/finmind') return json(res, { msg: 'success', data: finmind(url.searchParams.get('dataset'), url.searchParams.get('data_id')) });
    if (url.pathname === '/api/yahoo/search') return json(res, { quotes: [] });
    if (url.pathname.startsWith('/api')) return json(res, { error: '未定義API，禁止外送' }, 403);
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    let content, ext;
    if (url.pathname === '/profile') {
      const version = url.searchParams.get('version') === 'before' ? 'before' : 'after';
      const css = (await readFile(path.join(dist, 'index.html'), 'utf8')).match(/<link[^>]*href="([^"]+\.css)"[^>]*>/)?.[0] || '';
      content = `<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><script src="/__fixture/bootstrap.js"></script>${css}</head><body><div id="root"></div><script type="module" src="/__fixture/${version}.js"></script></body></html>`; ext = '.html';
    } else if (/^\/__fixture\/(before|after)\.js$/.test(url.pathname)) { content = bundles[url.pathname.includes('before') ? 'before' : 'after']; ext = '.js'; }
    else {
      const script = { '/__fixture/bootstrap.js': 'bootstrap.js', '/__fixture/cases.mjs': 'browser-cases.mjs', '/__fixture/edge-cases.mjs': 'edge-cases.mjs', '/__fixture/report.mjs': 'report.mjs' }[url.pathname];
      const file = script ? path.join(dir, script) : path.resolve(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, ''));
      if (!script && !file.startsWith(dist + path.sep)) return json(res, {}, 403);
      content = await readFile(file); ext = path.extname(file);
      if (ext === '.html') content = content.toString().replace(/<link\b[^>]*href="https:\/\/fonts\.googleapis\.com\/[^>]*>/g, '')
        .replace('<head>', '<head><script src="/__fixture/bootstrap.js"></script>');
    }
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' })[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'" });
    res.end(content);
  } catch (error) { json(res, { error: error.message }, 400); }
}).listen(4182, '127.0.0.1', () => console.log(JSON.stringify({ origin, pid: process.pid, baseline, outputTicket })));
