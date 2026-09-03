import { spawn } from 'node:child_process';
import console from 'node:console';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

if (process.env.WEB_LIVE_TEST !== '1') {
  console.error('WEB_LIVE_TEST 未设为 1，本地 Chromium 真实站点覆盖率基准未执行。');
  process.exit(2);
}

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'linnya-web-render-benchmark-'));
const bundlePath = path.join(tempRoot, 'electron-render-entry.cjs');

function readMinimumRate(args) {
  const index = args.indexOf('--min-success-rate');
  const parsed = Number(index >= 0 ? args[index + 1] : undefined);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : 0.95;
}

function percentile(values, rate) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * rate) - 1)];
}

try {
  await build({
    entryPoints: [path.join(repoRoot, 'scripts/benchmark/web-reliability/electron-render-entry.ts')],
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
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Electron 本地渲染覆盖率基准退出码 ${code}。\n${stdout}\n${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });

  const marker = output.split('\n').find((line) => line.startsWith('WEB_RENDER_COVERAGE_RESULT='));
  if (!marker) throw new Error(`Electron 本地渲染覆盖率基准未返回结果。\n${output}`);
  const attempts = JSON.parse(marker.slice('WEB_RENDER_COVERAGE_RESULT='.length));
  const contentAttempts = attempts.filter((attempt) => !attempt.expectedTerminal);
  const terminalAttempts = attempts.filter((attempt) => attempt.expectedTerminal);
  const covered = contentAttempts.filter((attempt) => attempt.contentCovered).length;
  const terminalPassed = terminalAttempts.filter((attempt) => attempt.contractSuccess).length;
  const rendered = contentAttempts.filter((attempt) => attempt.selectedProvider === 'local_render').length;
  const renderAttempts = contentAttempts.filter((attempt) => attempt.renderAttempted).length;
  const expectedCodeCases = contentAttempts.filter((attempt) => attempt.expectsCodeBlock);
  const expectedTableCases = contentAttempts.filter((attempt) => attempt.expectsTable);
  const codePreserved = expectedCodeCases.filter((attempt) => attempt.codeBlockPreserved).length;
  const tablePreserved = expectedTableCases.filter((attempt) => attempt.tablePreserved).length;
  const coverage = contentAttempts.length > 0 ? covered / contentAttempts.length : 0;
  const minSuccessRate = readMinimumRate(process.argv.slice(2));
  const latencies = attempts.map((attempt) => attempt.tookMs);

  console.log('# Web Read Local HTTP + Chromium Coverage Report\n');
  console.log(`- content coverage: ${covered}/${contentAttempts.length} (${(coverage * 100).toFixed(2)}%)`);
  console.log(`- threshold: ${(minSuccessRate * 100).toFixed(2)}% (${coverage >= minSuccessRate ? 'PASS' : 'FAIL'})`);
  console.log(`- render attempts / recovered by render: ${renderAttempts}/${rendered}`);
  console.log(`- expected terminal contracts: ${terminalPassed}/${terminalAttempts.length}`);
  console.log(`- code structure fidelity: ${codePreserved}/${expectedCodeCases.length}`);
  console.log(`- table structure fidelity: ${tablePreserved}/${expectedTableCases.length}`);
  console.log(`- latency p50/p95: ${percentile(latencies, 0.5)}ms / ${percentile(latencies, 0.95)}ms`);
  console.log('- managed Reader: disabled; failures measure the uncovered portion of the local two-layer route');
  console.log('');
  for (const attempt of attempts) {
    console.log(`- ${attempt.caseId}: provider=${attempt.selectedProvider}, render=${attempt.renderAttempted}, success=${attempt.contractSuccess}, failure=${attempt.failureKind ?? 'none'}, renderFailure=${attempt.renderFailureKind ?? 'none'}, renderedChars=${attempt.renderedCharCount ?? 0}, renderScore=${attempt.renderQualityScore ?? 'n/a'}, renderWarnings=${(attempt.renderWarnings ?? []).join(',') || 'none'}, detail=${attempt.renderFailureMessage ?? attempt.failureMessage ?? 'none'}, took=${attempt.tookMs}ms`);
  }
  if (coverage < minSuccessRate || terminalPassed !== terminalAttempts.length) process.exitCode = 1;
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
