'use strict';
// classify -> fitwarp -> convert (steps whose script is missing are skipped). usage: node scripts/bp3d/run_all.cjs [convert args]
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.resolve(__dirname, '..', '..');
const run = (cmd, args) => { console.log('>', cmd, args.join(' ')); const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' }); if (r.status) { console.error('step failed'); process.exit(r.status); } };
const t0 = Date.now();
if (fs.existsSync(path.join(__dirname, 'classify.cjs'))) run('node', [path.join(__dirname, 'classify.cjs')]);
const fw = path.join(__dirname, 'fitwarp.ts');
if (fs.existsSync(fw)) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bp3d_fw_')), 'fitwarp.cjs');
  require('esbuild').buildSync({ entryPoints: [fw], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error' });
  run('node', [out]);
}
run('node', [path.join(__dirname, 'convert.cjs'), ...process.argv.slice(2)]);
run('node', [path.join(__dirname, 'validate.cjs')]);
console.log('run_all total', ((Date.now() - t0) / 1000).toFixed(0) + 's');
