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
const bundledPluginRefreshHint = 'pnpm run package:plugins:official && pnpm run prepare:extra-resources';

function mtime(root, path) {
  return statSync(join(root, path), { throwIfNoEntry: false })?.mtimeMs;
}

function pluginOutputFreshness(root, plugin, outputRoot, outputPrefix) {
  const outputs = plugin.requiredOutputs.map(outputPath => ({
    path: `${outputPrefix}/${outputPath}`,
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
    return { stale: true, reason: `缺少 ${missing.path}` };
  }
  return judgeBuildFreshness(outputs, sources);
}

function pluginBuildFreshness(root, plugin) {
  const requiredOutputs = plugin.requiredOutputs ?? [];
  // 没有声明产物的开发插件（例如 decision、slides）不参与这项检查。
  // 不能把空数组交给 judgeBuildFreshness：它需要一个最旧产物作为比较基准。
  if (requiredOutputs.length === 0) return { stale: false };

  // 开发模式的 backend 从 package 自己的 dist 加载；它缺失或过期时必须先重建。
  const workspaceFreshness = pluginOutputFreshness(
    root,
    { ...plugin, requiredOutputs },
    plugin.packageDir,
    `${plugin.pluginId}`,
  );
  if (workspaceFreshness.stale) {
    return {
      ...workspaceFreshness,
      reason: `插件 ${plugin.pluginId} ${workspaceFreshness.reason.replace(
        `缺少 ${plugin.pluginId}/`,
        '缺少 ',
      )}`,
    };
  }

  // extraResources 是 seed 和“从随包重装”的来源，不是开发模式 backend 的加载源。
  // 仍单独检查它，避免探针在随包副本过期时误把旧 artifact 带入验收流程。
  const bundledRoot = join(root, 'extraResources', 'plugins', plugin.pluginId);
  if (!existsSync(bundledRoot)) return { stale: false };
  const bundledFreshness = pluginOutputFreshness(
    root,
    { ...plugin, requiredOutputs },
    bundledRoot,
    `extraResources/plugins/${plugin.pluginId}`,
  );
  if (bundledFreshness.stale) {
    return {
      ...bundledFreshness,
      kind: 'bundled',
      hint: bundledPluginRefreshHint,
    };
  }
  return bundledFreshness;
}

export function buildFreshness(root = repoRoot, { requireBundledPlugins = false } = {}) {
  // 插件自己声明运行必需的产物；主 bundle 较新不代表上一次插件构建已完成。
  for (const plugin of discoverWorkspaceDiskBackendPlugins(root)) {
    const pluginFreshness = pluginBuildFreshness(root, plugin);
    if (pluginFreshness.stale) {
      return pluginFreshness;
    }
  }
  // 随包模式从 extraResources/plugins 装配插件。整个目录缺失时 Desktop 只会少掉随包插件，
  // 旧资料里的插件随后因不在可信装配清单而让启动失败，探针只能等到 Renderer 超时；这里先生成。
  if (requireBundledPlugins && !process.env.LINNYA_PROBE_BUNDLED_PLUGIN_ROOT
    && !existsSync(join(root, 'extraResources', 'plugins'))) {
    return { stale: true, kind: 'bundled', reason: '缺少 extraResources/plugins', hint: bundledPluginRefreshHint };
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

function runCommand(command, args, fd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: ['ignore', fd, fd] });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new ProbeError('BUILD_FAILED', `${command} ${args.join(' ')} 失败：${code ?? signal}`, buildLog));
    });
  });
}

async function runBundledPluginRefresh() {
  const fd = openSync(buildLog, 'w', 0o600);
  try {
    await runCommand('pnpm', ['run', 'package:plugins:official'], fd);
    await runCommand('pnpm', ['run', 'prepare:extra-resources'], fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * 产物过期时直接重建；随包插件会重新生成完整官方集合，省去“启动超时 → 查日志 → 手工构建 → 重启”这一轮。
 * 多个实例同时启动只构建一次：拿到构建锁后重新判断。
 */
export async function ensureFreshBuild({
  root = repoRoot,
  build = true,
  requireBundledPlugins = false,
  runBuildCommand = runBuild,
  refreshBundledPlugins = runBundledPluginRefresh,
} = {}) {
  const freshnessOf = () => buildFreshness(root, { requireBundledPlugins });
  const first = freshnessOf();
  if (!first.stale) return { rebuilt: false };
  if (!build && first.kind === 'bundled') {
    throw new ProbeError('BUILD_STALE', `随包插件产物已过期：${first.reason}`, first.hint);
  }
  if (!build) {
    throw new ProbeError('BUILD_STALE', `开发产物已过期：${first.reason}`, '去掉 --no-build 让探针自动构建，或先运行 pnpm run dev:electron --build-only');
  }
  return withLifecycleLock(join(instancesRoot, 'build'), async () => {
    const current = freshnessOf();
    if (!current.stale) return { rebuilt: false, waitedForOtherBuild: true };
    const started = Date.now();
    let next = current;
    let bundledPluginsRefreshed = false;
    // workspace 构建与随包副本是两个独立产物面。源码变化时两边可能同时过期，
    // 所以每完成一个阶段都重新判断，不能把第二个过期面留给下一次 probe up。
    for (let attempt = 0; next.stale; attempt += 1) {
      if (attempt >= 3) {
        throw new ProbeError('BUILD_STALE', `多次刷新后产物仍过期：${next.reason}`, next.kind === 'bundled' ? next.hint : buildLog);
      }
      if (next.kind === 'bundled') {
        await refreshBundledPlugins();
        bundledPluginsRefreshed = true;
      } else {
        await runBuildCommand();
      }
      next = freshnessOf();
    }
    return {
      rebuilt: true,
      reason: current.reason,
      buildMs: Date.now() - started,
      log: buildLog,
      ...(bundledPluginsRefreshed ? { bundledPluginsRefreshed: true } : {}),
    };
  }, { timeoutMs: buildTimeoutMs });
}
