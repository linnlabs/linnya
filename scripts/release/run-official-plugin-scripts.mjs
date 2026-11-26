#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { preparePluginArtifactForSmoke } from './orchestration/preparePluginArtifactForSmoke.mjs';

import {
  listOfficialPluginReleaseTargetIds,
  repoRoot,
  resolvePluginPackageDir,
} from './plugin-release-targets.mjs';

const [scriptKind, ...args] = process.argv.slice(2);
function selectTargets() {
  if (args.length === 0 && ['package', 'smoke-artifact'].includes(scriptKind)) return listOfficialPluginReleaseTargetIds();
  if (scriptKind === 'prepare-smoke' && args.length === 1 && /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(args[0])) return args;
  throw new Error('Usage: run-official-plugin-scripts.mjs package | smoke-artifact | prepare-smoke <pluginId>');
}

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
let schemasBuilt = false;
for (const id of selectTargets()) {
  // 专项 smoke 的 Worker 与夹具属于仓内插件；发行批次则遵循发行目标的路径覆盖。
  const packageDir = resolvePluginPackageDir(id, scriptKind === 'prepare-smoke' ? {} : process.env);
  const build = () => {
    // 插件的独立浏览器入口消费 schemas 的正式导出，同一批打包只需要准备一次。
    if (!schemasBuilt) {
      runCommand(pnpmCommand, ['run', 'build:schemas'], repoRoot);
      schemasBuilt = true;
    }
    console.log(`[official-plugin:${scriptKind}] ${id} package:artifact`);
    runCommand(pnpmCommand, ['run', 'package:artifact'], packageDir);
  };
  if (scriptKind === 'package') build();
  else preparePluginArtifactForSmoke({ packageDir, repoRoot, build });
  if (scriptKind === 'smoke-artifact') {
    runCommand(process.execPath, [
      'scripts/release/smoke-plugin-artifact.mjs',
      id,
      '--require-renderer-assets',
    ], repoRoot);
  }
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    // Windows 的 pnpm.cmd 是批处理入口，不能交给 CreateProcess 直接执行。
    // 这里只对固定的 pnpm 命令启用 shell；Node verifier 继续直接启动。
    shell: process.platform === 'win32' && command === 'pnpm.cmd',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
