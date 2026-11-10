import { execFileSync, spawn } from 'node:child_process';
import { closeSync, openSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ProbeError, repoRoot } from '../definitions/probeContract.mjs';
import { feedsDesktopBundle, judgeBuildFreshness } from '../functions/desktopBundleSources.mjs';
import { instancesRoot, withLifecycleLock } from '../infrastructure/instanceStore.mjs';

const outputs = ['dist/main/main.cjs', 'dist/main/preload.js', 'dist/main/app-server-backend.cjs'];
const buildLog = join(instancesRoot, 'build.log');
const buildTimeoutMs = 10 * 60_000;

function mtime(path) {
  return statSync(join(repoRoot, path), { throwIfNoEntry: false })?.mtimeMs;
}

export function buildFreshness() {
  const sources = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'src', 'packages'], {
    cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  }).split('\0').filter(path => path && feedsDesktopBundle(path))
    .map(path => ({ path, mtimeMs: mtime(path) ?? 0 }));
  return judgeBuildFreshness(outputs.map(path => ({ path, mtimeMs: mtime(path) })), sources);
}

function runBuild() {
  const fd = openSync(buildLog, 'w', 0o600);
  try {
    const child = spawn('pnpm', ['run', 'dev:electron', '--build-only'], { cwd: repoRoot, stdio: ['ignore', fd, fd] });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => child.kill('SIGTERM'), buildTimeoutMs);
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new ProbeError('BUILD_FAILED', `开发构建失败：${code ?? signal}`, buildLog));
      });
    });
  } finally {
    closeSync(fd);
  }
}

/**
 * 产物过期时直接重建，省去“启动超时 → 查日志 → 手工构建 → 重启”这一轮。
 * 多个实例同时启动只构建一次：拿到构建锁后重新判断。
 */
export async function ensureFreshBuild({ build = true } = {}) {
  const first = buildFreshness();
  if (!first.stale) return { rebuilt: false };
  if (!build) {
    throw new ProbeError('BUILD_STALE', `开发产物已过期：${first.reason}`, '去掉 --no-build 让探针自动构建，或先运行 pnpm run dev:electron --build-only');
  }
  return withLifecycleLock(join(instancesRoot, 'build'), async () => {
    const current = buildFreshness();
    if (!current.stale) return { rebuilt: false, waitedForOtherBuild: true };
    const started = Date.now();
    await runBuild();
    const after = buildFreshness();
    if (after.stale) throw new ProbeError('BUILD_STALE', `构建后产物仍过期：${after.reason}`, buildLog);
    return { rebuilt: true, reason: current.reason, buildMs: Date.now() - started, log: buildLog };
  }, { timeoutMs: buildTimeoutMs });
}
