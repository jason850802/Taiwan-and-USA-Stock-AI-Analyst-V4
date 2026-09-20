#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = new Set(process.argv.slice(2));
const budgetIndex = process.argv.indexOf('--budget-kb');
const budgetKb = budgetIndex === -1 ? null : Number(process.argv[budgetIndex + 1]);

if (budgetKb !== null && (!Number.isFinite(budgetKb) || budgetKb <= 0)) {
  console.error('用法：node scripts/measure-initial-bundle.mjs [--skip-build] [--budget-kb 400] [--json]');
  process.exit(2);
}

if (!args.has('--skip-build')) {
  const isWindows = process.platform === 'win32';
  const buildCommand = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const buildArgs = isWindows ? ['/d', '/s', '/c', 'npm.cmd run build'] : ['run', 'build'];
  const build = spawnSync(buildCommand, buildArgs, {
    cwd: root,
    stdio: 'inherit',
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const distDir = path.join(root, 'dist');
const indexHtml = readFileSync(path.join(distDir, 'index.html'), 'utf8');
const initialJs = new Set();

for (const match of indexHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js)["'][^>]*>/gi)) {
  initialJs.add(match[1]);
}
for (const match of indexHtml.matchAll(/<link\b[^>]*\brel=["']modulepreload["'][^>]*\bhref=["']([^"']+\.js)["'][^>]*>/gi)) {
  initialJs.add(match[1]);
}

const assets = [...initialJs].sort().map(url => {
  const relativePath = url.replace(/^\//, '');
  const absolutePath = path.join(distDir, relativePath.replace(/^dist[\\/]/, ''));
  const contents = readFileSync(absolutePath);
  return {
    file: relativePath,
    rawBytes: statSync(absolutePath).size,
    gzipBytes: gzipSync(contents).length,
  };
});

const totals = assets.reduce((sum, asset) => ({
  rawBytes: sum.rawBytes + asset.rawBytes,
  gzipBytes: sum.gzipBytes + asset.gzipBytes,
}), { rawBytes: 0, gzipBytes: 0 });

const result = {
  initialJsAssets: assets,
  totalRawKb: Number((totals.rawBytes / 1024).toFixed(2)),
  totalGzipKb: Number((totals.gzipBytes / 1024).toFixed(2)),
  budgetKb,
  withinBudget: budgetKb === null ? null : totals.rawBytes <= budgetKb * 1024,
};

if (args.has('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('\n初始 JavaScript graph');
  for (const asset of assets) {
    console.log(`  ${asset.file}: ${(asset.rawBytes / 1024).toFixed(2)} kB raw / ${(asset.gzipBytes / 1024).toFixed(2)} kB gzip`);
  }
  console.log(`  合計：${result.totalRawKb.toFixed(2)} kB raw / ${result.totalGzipKb.toFixed(2)} kB gzip`);
  if (budgetKb !== null) {
    console.log(`  預算：${budgetKb.toFixed(2)} kB raw → ${result.withinBudget ? 'PASS' : 'FAIL'}`);
  }
}

if (result.withinBudget === false) process.exit(1);
