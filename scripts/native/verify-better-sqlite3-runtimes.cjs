#!/usr/bin/env node

/**
 * 验证 better-sqlite3 的目标平台 N-API 制品能被开发 Node 与生产 Electron 同时加载。
 * better-sqlite3 13 已使用 N-API 10，不再需要维护两份 V8 ABI 二进制。
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  inspectNativeBinaryTarget,
} = require('../build/functions/production-package-contract.cjs');
const { ensureElectronInstalled } = require('./ensure-electron-installed.cjs');

const rootDir = path.resolve(__dirname, '..', '..');
const packageDir = path.dirname(require.resolve('better-sqlite3/package.json'));
const platformTarget = process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime
  ? 'linuxmusl'
  : process.platform;
const nativeBindingPath = path.join(
  packageDir,
  'prebuilds',
  `${platformTarget}-${process.arch}.node`,
);

if (!fs.existsSync(nativeBindingPath)) {
  throw new Error(`[better-sqlite3] 缺少目标平台 N-API 制品：${nativeBindingPath}`);
}

const binaryTarget = inspectNativeBinaryTarget(nativeBindingPath);
if (binaryTarget.platform !== process.platform || binaryTarget.architecture !== process.arch) {
  throw new Error(
    `[better-sqlite3] 制品目标不匹配：期望 ${process.platform}/${process.arch}，`
    + `实际 ${binaryTarget.platform}/${binaryTarget.architecture}`,
  );
}

function runNodeSmoke() {
  const Database = require('better-sqlite3');
  const database = new Database(':memory:');
  const row = database.prepare('SELECT 1 AS ok').get();
  database.close();
  if (!row || row.ok !== 1) {
    throw new Error('[better-sqlite3] Node smoke query 返回了错误结果。');
  }
}

ensureElectronInstalled();
runNodeSmoke();
execFileSync(process.execPath, [
  require.resolve('electron/cli.js'),
  path.join(__dirname, 'check-better-sqlite-electron.cjs'),
], {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
  },
});

console.log(
  `[better-sqlite3] OK: ${path.relative(rootDir, nativeBindingPath)} 已通过 Node 与 Electron 查询验收。`,
);
