import { spawn } from 'node:child_process';
import { listGitFiles } from '../../../../source-analysis/listGitFiles.mjs';
import { closeSync, openSync, statSync } from 'node:fs';
import { discoverWorkspaceDiskBackendPlugins } from '../../plugin-backend-composition/functions/discoverWorkspaceDiskBackendPlugins.mjs';
import { join } from 'node:path';
import { ProbeError, repoRoot } from '../definitions/probeContract.mjs';
import { dependencyInstallMarkers, feedsDesktopBundle, judgeBuildFreshness } from '../functions/desktopBundleSources.mjs';
import { instancesRoot, withLifecycleLock } from '../infrastructure/instanceStore.mjs';

const outputs = ['dist/main/main.cjs', 'dist/main/preload.js', 'dist/main/app-server-backend.cjs'];
const buildLog = join(instancesRoot, 'build.log');
const buildTimeoutMs = 10 * 60_000;

function mtime(root, path) {
  return statSync(join(root, path), { throwIfNoEntry: false })?.mtimeMs;
}

export function buildFreshness(root = repoRoot) {
  // 插件自己声明运行必需的产物；主 bundle 较新不代表上一次插件构建已完成。
  for (const plugin of discoverWorkspaceDiskBackendPlugins(root)) {
    for (const output of plugin.requiredOutputs ?? []) {
      if (!statSync(join(plugin.packageDir, output), { throwIfNoEntry: false })?.isFile()) {
        return { stale: true, reason: `插件 ${plugin.pluginId} 缺少 ${output}` };
      }
    }
  }
  const sources = [
    ...listGitFiles(['--cached', '--others', '--exclude-standard', '--', 'src', 'packages'], { cwd: root })
      .filter(path => feedsDesktopBundle(path)),
    ...dependencyInstallMarkers,
  ].map(path => ({ path, mtimeMs: mtime(root, path) ?? 0 }));
  return judgeBuildFreshness(outputs.map(path => ({ path, mtimeMs: mtime(root, path) })), sources);
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
