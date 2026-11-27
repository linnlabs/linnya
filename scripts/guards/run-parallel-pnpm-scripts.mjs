#!/usr/bin/env node

import { spawn } from 'node:child_process';

import {
  resolveGuardConcurrency,
  runParallelPnpmScripts,
  validateScriptNames,
} from './functions/parallelPnpmScripts.mjs';

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const activeChildren = new Set();

function terminateActiveChildren(signal = 'SIGTERM') {
  for (const child of activeChildren) {
    if (!child.killed) child.kill(signal);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    terminateActiveChildren(signal);
    process.exit(1);
  });
}

function runPnpmScript({ name, cwd, buffered }) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(pnpmCommand, ['run', name], {
      cwd,
      env: {
        ...process.env,
        // 一次性门禁脚本不依赖跨进程 tsx 磁盘缓存，避免每次运行往系统 $TMPDIR/tsx-* 写入并扫描大量条目。
        TSX_DISABLE_CACHE: process.env.TSX_DISABLE_CACHE ?? '1',
      },
      stdio: buffered ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      // Windows 的 pnpm.cmd 是批处理入口，不能交给 CreateProcess 直接执行。
      shell: process.platform === 'win32' && pnpmCommand === 'pnpm.cmd',
    });
    activeChildren.add(child);

    const chunks = [];
    if (buffered) {
      child.stdout?.on('data', chunk => chunks.push({ stream: process.stdout, chunk }));
      child.stderr?.on('data', chunk => chunks.push({ stream: process.stderr, chunk }));
    }

    child.once('error', error => {
      activeChildren.delete(child);
      reject(error);
    });

    child.once('close', (code, signal) => {
      activeChildren.delete(child);
      const durationMs = Date.now() - startedAt;
      const exitCode = typeof code === 'number' ? code : 1;
      const statusLabel = exitCode === 0 ? 'passed' : `failed (exit=${exitCode}${signal ? `, signal=${signal}` : ''})`;
      if (buffered) {
        process.stdout.write(`[parallel-guard] ${name} ${statusLabel} (${(durationMs / 1000).toFixed(2)}s)\n`);
        for (const entry of chunks) entry.stream.write(entry.chunk);
      }
      resolve({ exitCode, durationMs, output: '' });
    });
  });
}

async function main() {
  const scripts = validateScriptNames(process.argv.slice(2));
  const concurrency = resolveGuardConcurrency(process.env.LINNYA_GUARD_CONCURRENCY, scripts.length);
  const buffered = concurrency > 1;

  const summary = await runParallelPnpmScripts({
    scripts,
    concurrency,
    cwd: process.cwd(),
    runScript: ({ name, cwd }) => runPnpmScript({ name, cwd, buffered }),
  });

  if (!summary.ok) {
    const failed = summary.results.filter(item => item.exitCode !== 0);
    console.error(
      `[parallel-guard] ${failed.length}/${summary.results.length} guard(s) failed: `
      + failed.map(item => `${item.name} (exit=${item.exitCode})`).join(', '),
    );
    process.exit(summary.firstFailureExitCode);
  }
}

main().catch(error => {
  terminateActiveChildren('SIGTERM');
  console.error(error);
  process.exit(1);
});
