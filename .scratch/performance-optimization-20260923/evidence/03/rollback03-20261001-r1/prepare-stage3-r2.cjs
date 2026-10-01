const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const old = fs.readFileSync(path.join(root, 'rehearse-combined.cjs'), 'utf8');
const next = old.replaceAll('commands-stage3.json', 'commands-stage3-r2.json').replaceAll('combined-reverted.diff', 'combined-reverted-r2.diff').replaceAll('combined.json', 'combined-r2.json').replaceAll("'--settings'", "'--setting-sources'");
fs.writeFileSync(path.join(root, 'rehearse-combined-r2.cjs'), next, { flag: 'wx' });
