#!/usr/bin/env node

/**
 * 确保 Electron npm 包和平台二进制同时存在。
 *
 * Electron 的 JS 包与约 100MB 的平台二进制是分开安装的。pnpm 恢复缓存、
 * 安装过程被中断或切换平台后，可能只留下包外壳；此时原生模块虽然能完成
 * rebuild，最终的 Electron runtime 验收仍会失败。这里在原生模块构建前把
 * 这个前置条件收口，并复用 Electron 官方的幂等安装脚本。
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');
const rootPackage = require(path.join(rootDir, 'package.json'));
const electronPackageDir = path.dirname(require.resolve('electron/package.json'));
const electronInstallScript = path.join(electronPackageDir, 'install.js');
const electronPathFile = path.join(electronPackageDir, 'path.txt');
const defaultElectronMirror = rootPackage.build?.electronDownload?.mirror;

function resolveInstalledElectronPath() {
  if (!fs.existsSync(electronPathFile)) {
    return null;
  }

  const relativePath = fs.readFileSync(electronPathFile, 'utf8').trim();
  if (!relativePath) {
    return null;
  }

  const distDir = process.env.ELECTRON_OVERRIDE_DIST_PATH
    || path.join(electronPackageDir, 'dist');
  const executablePath = path.join(distDir, relativePath);
  return fs.existsSync(executablePath) ? executablePath : null;
}

function ensureElectronInstalled() {
  const installedPath = resolveInstalledElectronPath();
  if (installedPath) {
    console.log(`[electron install] OK: ${installedPath}`);
    return installedPath;
  }

  console.log('[electron install] Electron 包存在，但平台二进制缺失，开始执行官方安装脚本...');
  execFileSync(process.execPath, [electronInstallScript], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || defaultElectronMirror,
    },
  });

  const downloadedPath = resolveInstalledElectronPath();
  if (!downloadedPath) {
    throw new Error(
      '[electron install] 安装脚本执行完成，但 Electron 可执行文件仍不存在。'
      + '请检查 ELECTRON_SKIP_BINARY_DOWNLOAD 和下载网络配置。',
    );
  }

  console.log(`[electron install] OK: ${downloadedPath}`);
  return downloadedPath;
}

if (require.main === module) {
  ensureElectronInstalled();
}

module.exports = {
  ensureElectronInstalled,
};
