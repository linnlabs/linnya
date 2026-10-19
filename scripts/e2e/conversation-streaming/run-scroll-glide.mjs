import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import electronPath from 'electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const temporary = await mkdtemp(join(tmpdir(), 'linnya-streaming-scroll-'));
try {
  await build({
    entryPoints: [join(root, 'scripts/e2e/conversation-streaming/scroll-glide.fixture.ts')],
    outfile: join(temporary, 'fixture.js'), bundle: true, format: 'iife', platform: 'browser',
    define: {
      'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    },
  });
  await writeFile(join(temporary, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"></head><body><script src="fixture.js"></script></body></html>');
  await writeFile(join(temporary, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
const { join } = require('node:path');
app.setPath('userData', join(__dirname, 'profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await window.loadFile(join(__dirname, 'index.html'));
  const timer = setInterval(async () => {
    const raw = await window.webContents.executeJavaScript('document.body.dataset.result');
    if (!raw) return;
    clearInterval(timer);
    const result = JSON.parse(raw);
    console.log(JSON.stringify(result));
    app.exit(result.passed ? 0 : 1);
  }, 100);
}).catch(error => { console.error(error); app.exit(1); });
setTimeout(() => { console.error('Streaming scroll fixture timed out'); app.exit(1); }, 20000).unref();
`);
  const result = spawnSync(electronPath, [join(temporary, 'main.cjs')], {
    cwd: root, encoding: 'utf8', timeout: 25000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Electron streaming scroll regression failed');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
