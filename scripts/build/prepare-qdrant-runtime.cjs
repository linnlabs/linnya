#!/usr/bin/env node

const path = require('node:path');

const {
  prepareQdrantRuntime,
} = require('./qdrant-runtime/orchestration/prepare-qdrant-runtime.cjs');

const rootDir = path.resolve(__dirname, '..', '..');
const targetPlatform = process.env.LINNYA_BUILD_TARGET_PLATFORM ?? process.platform;
const targetArchitecture = process.env.LINNYA_BUILD_TARGET_ARCH ?? process.arch;
const allowCrossTarget = process.argv.slice(2).includes('--allow-cross-target');

prepareQdrantRuntime({
  rootDir,
  platform: targetPlatform,
  architecture: targetArchitecture,
  allowCrossTarget,
})
  .then(result => {
    const action = result.changed ? '已按锁定清单准备' : '已通过锁定清单校验';
    process.stdout.write(
      `[qdrant-runtime] Qdrant ${result.version} ${action}：${result.executablePath}\n`
    );
  })
  .catch(error => {
    process.stderr.write(
      `[qdrant-runtime] 准备失败：${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
