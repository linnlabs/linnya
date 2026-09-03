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
  if (scriptKind === 'smoke-artifact') {
    runCommand(pnpmCommand, ['run', 'build:schemas'], repoRoot);
  }
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
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
