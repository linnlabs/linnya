#!/usr/bin/env node

/**
 * 验证 Main 字节码由真实 Electron Main Process 生成，并能被相同 runtime 加载。
 * App Server 刻意不编译 Electron 字节码：它由固定 headless Node 加载普通 CJS。
 */

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..', '..');
const electronPath = require('electron');
const electronVersion = require('electron/package.json').version;
const compilerPath = path.join(rootDir, 'scripts/build/compile-electron-main-bytecode.cjs');
const mainBytecodePath = path.join(rootDir, 'dist/main/main.jsc');
const appServerBackendPath = path.join(rootDir, 'dist/main/app-server-backend.cjs');
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-bytecode-e2e-'));

try {
  const sourcePath = path.join(tempDirectory, 'fixture.cjs');
  const bytecodePath = path.join(tempDirectory, 'fixture.jsc');
  const resultPath = path.join(tempDirectory, 'result.json');
  const loaderPath = path.join(tempDirectory, 'loader.cjs');

  fs.writeFileSync(
    sourcePath,
    "module.exports = { processType: process.type, electron: process.versions.electron };\n",
  );
  execFileSync(process.execPath, [compilerPath, sourcePath, bytecodePath], {
    cwd: rootDir,
    stdio: 'inherit',
  });

  assert.ok(fs.existsSync(mainBytecodePath), '请先运行 pnpm run compile:bytecode');
  assert.ok(fs.existsSync(appServerBackendPath), '请先运行 pnpm run build:backend');
  const appServerBackend = require(appServerBackendPath);
  assert.equal(typeof appServerBackend.runLinnyaAppServerProcess, 'function');
  fs.writeFileSync(loaderPath, `
const { app } = require('electron');
const fs = require('node:fs');
require(${JSON.stringify(require.resolve('bytenode'))});
app.whenReady().then(() => {
  const fixture = require(${JSON.stringify(bytecodePath)});
  fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({
    fixture,
  }));
  app.quit();
}).catch(error => {
  process.stderr.write(String(error && error.stack || error));
  app.exit(1);
});
`);

  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  execFileSync(electronPath, [loaderPath], {
    cwd: rootDir,
    stdio: 'inherit',
    env: environment,
  });

  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  assert.deepEqual(result.fixture, {
    processType: 'browser',
    electron: electronVersion,
  });
  console.log(
    `[bytecode e2e] OK: Electron ${electronVersion} Main Process 字节码与 headless App Server CJS 边界有效。`,
  );
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
