#!/usr/bin/env node

const { createHash } = require('node:crypto');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const cliRoot = path.resolve(__dirname, '..');
const bundlePath = path.join(cliRoot, 'dist/cli.cjs');
const manifestPath = path.join(cliRoot, 'dist/build.json');

function verifyBundle() {
  if (!existsSync(bundlePath) || !existsSync(manifestPath)) {
    throw new Error('CLI bundle is missing build evidence. Run pnpm build:linnya-cli in the repository.');
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const artifactHash = createHash('sha256').update(readFileSync(bundlePath)).digest('hex');
  if (manifest.schema_version !== 1 || manifest.bundle_sha256 !== artifactHash) {
    throw new Error('CLI bundle and build evidence do not match. Run pnpm build:linnya-cli.');
  }
  // 独立分发仅校验 artifact；仓库开发入口额外拒绝旧源码构建，绝不自动切入口。
  if (existsSync(path.join(cliRoot, 'src/main.ts'))) {
    const { createCliSourceFingerprint } = require('../build/sourceFingerprint.cjs');
    if (manifest.source_sha256 !== createCliSourceFingerprint(cliRoot)) {
      throw new Error('CLI bundle is stale. Run pnpm build:linnya-cli, or use pnpm --silent linnya:cli for source mode.');
    }
  }
}

try {
  verifyBundle();
} catch (error) {
  process.stderr.write(`${JSON.stringify({ schema_version: 1, ok: false, error: {
    code: 'protocol_incompatible',
    message: error instanceof Error ? error.message : 'Cannot verify CLI bundle',
    retryable: false,
  } })}\n`);
  process.exit(4);
}
require(bundlePath);
