import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'linnya-web-render-e2e-'));
const bundlePath = path.join(tempRoot, 'electron-entry.cjs');

try {
  await build({
    entryPoints: [path.join(repoRoot, 'scripts/e2e/web-render/electron-entry.ts')],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
    logLevel: 'silent',
  });

  const output = await new Promise((resolve, reject) => {
    const child = spawn(electronPath, [bundlePath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Electron Web Render E2E 超过 30 秒。\n${stdout}\n${stderr}`));
    }, 30_000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Electron Web Render E2E 退出码 ${code}。\n${stdout}\n${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });

  const marker = output.split('\n').find((line) => line.startsWith('WEB_RENDER_E2E_RESULT='));
  if (!marker) throw new Error(`Electron Web Render E2E 未返回结果。\n${output}`);
  const result = JSON.parse(marker.slice('WEB_RENDER_E2E_RESULT='.length));
  const expected = {
    spaRendered: true,
    permissionDenied: true,
    sameHostRedirected: true,
    crossRedirectKind: 'navigation_blocked',
    timeoutKind: 'total_timeout',
    privateNetworkKind: 'render_failed',
    recoveredAfterBlockedNavigation: true,
    popupRequests: 0,
    downloadRequests: 2,
  };
  if (JSON.stringify(result) !== JSON.stringify(expected)) {
    throw new Error(`Electron Web Render E2E 结果不符合预期。\nactual=${JSON.stringify(result)}\nexpected=${JSON.stringify(expected)}`);
  }
  console.log('[electron-web-render-e2e] SPA、导航、弹窗、下载、权限与超时边界通过。');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
