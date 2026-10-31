#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

import {
  listOfficialPluginReleaseTargetIds,
  repoRoot,
  resolvePluginPackageDir,
} from './plugin-release-targets.mjs';

const scriptKind = process.argv[2];
const supportedScriptKinds = new Set(['package', 'smoke-artifact']);

if (!supportedScriptKinds.has(scriptKind)) {
  console.error('Usage: node scripts/release/run-official-plugin-scripts.mjs <package|smoke-artifact>');
  process.exitCode = 1;
} else {
  const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  // 插件的独立浏览器入口消费 schemas 的正式导出；全新 checkout 不能借用旧 dist。
  runCommand(pnpmCommand, ['run', 'build:schemas'], repoRoot);
  for (const pluginId of listOfficialPluginReleaseTargetIds()) {
    const packageDir = resolvePluginPackageDir(pluginId);
    console.log(`[official-plugin:${scriptKind}] ${pluginId} package:artifact`);
    runCommand(pnpmCommand, ['run', 'package:artifact'], packageDir);
    if (scriptKind === 'smoke-artifact') {
      runCommand(process.execPath, [
        'scripts/release/smoke-plugin-artifact.mjs',
        pluginId,
        '--require-renderer-assets',
      ], repoRoot);
    }
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
