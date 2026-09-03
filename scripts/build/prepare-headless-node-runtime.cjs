#!/usr/bin/env node

const path = require('node:path');

const {
  prepareHeadlessNodeRuntime,
} = require('./headless-node-runtime/orchestration/prepare-headless-node-runtime.cjs');

const rootDir = path.resolve(__dirname, '..', '..');
const targetPlatform = process.env.LINNYA_BUILD_TARGET_PLATFORM ?? process.platform;
const targetArchitecture = process.env.LINNYA_BUILD_TARGET_ARCH ?? process.arch;
const allowCrossTarget = process.argv.slice(2).includes('--allow-cross-target');

prepareHeadlessNodeRuntime({
  rootDir,
  platform: targetPlatform,
  architecture: targetArchitecture,
  allowCrossTarget,
}).then(result => {
  process.stdout.write(
    `[headless-node-runtime] Node runtime 已准备：${result.executablePath}\n`,
  );
}).catch(error => {
  process.stderr.write(
    `[headless-node-runtime] 准备失败：${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
