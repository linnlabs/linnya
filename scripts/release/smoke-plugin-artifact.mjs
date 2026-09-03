#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import prepareExtraResources from '../build/prepare-extra-resources.cjs';
import { readSinglePluginIdFromCli, repoRoot } from './plugin-release-targets.mjs';

const pluginId = readSinglePluginIdFromCli({
  scriptName: 'scripts/release/smoke-plugin-artifact.mjs',
});
const shouldRequireRendererAssets = process.argv.includes('--require-renderer-assets');
const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), `linnya-plugin-${pluginId}-artifact-smoke-`)
);
const bundledPluginRoot = path.join(tempRoot, 'bundled-plugins');

const run = (command, args, env) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 1}`);
  }
};

try {
  await prepareExtraResources.preparePluginBundles({
    pluginIds: [pluginId],
    pluginResourceRoot: bundledPluginRoot,
    resetRoot: true,
    requireExactPluginIds: true,
  });

  const smokeEnv = {
    ...process.env,
    LINNYA_BUNDLED_PLUGIN_ROOT: bundledPluginRoot,
    LINNYA_PLUGIN_ARTIFACT_SMOKE_ID: pluginId,
  };
  run(
    process.execPath,
    [
      'scripts/release/verify-plugin-artifact.mjs',
      pluginId,
      '--extra-resources',
      ...(shouldRequireRendererAssets ? ['--require-renderer-assets'] : []),
    ],
    smokeEnv
  );
  run(
    process.execPath,
    [
      '--import',
      'tsx/cjs',
      '--eval',
      "require('./scripts/release/orchestration/verifyPluginArtifactRuntime.ts')",
    ],
    smokeEnv
  );

  console.log(`[plugin-artifact:${pluginId}] isolated bundled-root smoke passed`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
