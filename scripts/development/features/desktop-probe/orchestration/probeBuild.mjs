import { spawn } from 'node:child_process';
import { listGitFiles } from '../../../../source-analysis/listGitFiles.mjs';
import { closeSync, existsSync, openSync, statSync } from 'node:fs';
import { discoverWorkspaceDiskBackendPlugins } from '../../plugin-backend-composition/functions/discoverWorkspaceDiskBackendPlugins.mjs';
import { join, relative } from 'node:path';
import { ProbeError, repoRoot } from '../definitions/probeContract.mjs';
import { dependencyInstallMarkers, feedsDesktopBundle, judgeBuildFreshness } from '../functions/desktopBundleSources.mjs';
import { instancesRoot, withLifecycleLock } from '../infrastructure/instanceStore.mjs';

const outputs = ['dist/main/main.cjs', 'dist/main/preload.js', 'dist/main/app-server-backend.cjs'];
const buildLog = join(instancesRoot, 'build.log');
const buildTimeoutMs = 10 * 60_000;

function mtime(root, path) {
  return statSync(join(root, path), { throwIfNoEntry: false })?.mtimeMs;
}

function pluginBuildFreshness(root, plugin) {
  const requiredOutputs = plugin.requiredOutputs ?? [];
  // 没有声明产物的开发插件（例如 decision、slides）不参与这项检查。
  // 不能把空数组交给 judgeBuildFreshness：它需要一个最旧产物作为比较基准。
  if (requiredOutputs.length === 0) return { stale: false };

  // 探针加载随包插件时使用 extraResources 的副本；只有没有随包副本的开发插件
  // 才回退到 package 自己的 dist（例如尚未进入官方随包集合的 canvas）。
  const bundledRoot = join(root, 'extraResources', 'plugins', plugin.pluginId);
  const outputRoot = existsSync(bundledRoot) ? bundledRoot : plugin.packageDir;
  const outputs = requiredOutputs.map(outputPath => ({
    path: `${plugin.pluginId}/${outputPath}`,
    mtimeMs: mtime(root, relative(root, join(outputRoot, outputPath))),
  }));
  const packagePath = relative(root, plugin.packageDir).replaceAll('\\', '/');
  const sources = listGitFiles(
    ['--cached', '--others', '--exclude-standard', '--', packagePath],
    { cwd: root },
  )
    .filter(path => feedsDesktopBundle(path))
    .map(path => ({ path, mtimeMs: mtime(root, path) ?? 0 }));
  const missing = outputs.find(output => output.mtimeMs === undefined);
  if (missing) {
    return { stale: true, reason: `缺少 ${missing.path.slice(`${plugin.pluginId}/`.length)}` };
  }
  return judgeBuildFreshness(outputs, sources);
}

export function buildFreshness(root = repoRoot) {
  // 插件自己声明运行必需的产物；主 bundle 较新不代表上一次插件构建已完成。
  for (const plugin of discoverWorkspaceDiskBackendPlugins(root)) {
    const pluginFreshness = pluginBuildFreshness(root, plugin);
    if (pluginFreshness.stale) {
      return {
        stale: true,
        reason: `插件 ${plugin.pluginId} ${pluginFreshness.reason}`,
      };
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
