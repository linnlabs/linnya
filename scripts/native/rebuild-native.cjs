#!/usr/bin/env node

/**
 * 跨平台切换后重建原生模块
 * 用于 Mac 和 Windows 之间切换开发时快速修复原生依赖
 */

const { execFileSync, execSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { ensureElectronInstalled } = require('./ensure-electron-installed.cjs');

const platform = os.platform();
const isWindows = platform === 'win32';
const rootDir = path.resolve(__dirname, '..', '..');
const electronBuilderInstallDeps = require.resolve('electron-builder/install-app-deps.js');

console.log(`🔧 检测到平台: ${platform}`);
console.log('📦 开始重建原生模块...\n');

// Windows 上检查 Visual Studio
if (isWindows) {
  console.log('🔍 检查 Windows 构建环境...');
  try {
    // 尝试查找 Visual Studio
    const vsWherePath = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
    if (fs.existsSync(vsWherePath)) {
      try {
        execSync(`"${vsWherePath}" -latest`, { stdio: 'ignore' });
        console.log('   ✅ 检测到 Visual Studio 安装');
      } catch {
        console.log('   ⚠️  警告: 未找到有效的 Visual Studio 安装');
        console.log('   💡 如果编译失败，请安装 Visual Studio Build Tools:');
        console.log('      https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022');
        console.log('      选择 "使用 C++ 的桌面开发" 工作负载\n');
      }
    } else {
      console.log('   ⚠️  警告: 未检测到 Visual Studio');
      console.log('   💡 如果编译失败，请安装 Visual Studio Build Tools\n');
    }
  } catch (e) {
    // 忽略检查错误，继续执行
  }
}

try {
  // 步骤 0: 构建 schemas 包
  console.log('0️⃣ 构建 @app/schemas 包...');
  if (isWindows) {
    execSync('pnpm --dir packages/schemas run build', {
      cwd: rootDir,
      stdio: 'inherit',
      shell: 'powershell.exe',
    });
  } else {
    execSync('pnpm --dir packages/schemas run build', { cwd: rootDir, stdio: 'inherit' });
  }

  // Electron 的 npm 包外壳和平台二进制可能因缓存恢复或下载中断而不完整。
  console.log('\n1️⃣ 检查 Electron 平台二进制...');
  ensureElectronInstalled();

  // 步骤 1: 重建 Electron 应用依赖（这会自动编译原生模块）
  console.log('\n2️⃣ 重建 Electron 应用依赖...');
  console.log('   ⚠️  如果失败，请确保已安装 Visual Studio Build Tools (Windows)');
  execFileSync(process.execPath, [electronBuilderInstallDeps], {
    cwd: rootDir,
    stdio: 'inherit',
  });

  // 重建完成后统一验证关键原生模块，不能把任一运行时的加载失败留到启动阶段。
  console.log('\n3️⃣ 验证项目约定的原生模块布局...');
  execFileSync(process.execPath, [path.join(__dirname, 'rebuild-native-modules.cjs')], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  execFileSync(process.execPath, [path.join(__dirname, 'verify-better-sqlite3-runtimes.cjs')], {
    cwd: rootDir,
    stdio: 'inherit',
  });

  console.log('\n✅ 原生模块重建完成！');
  console.log('💡 现在可以运行: pnpm run dev:electron\n');

} catch (error) {
  console.error('\n❌ 重建失败:', error.message);
  
  if (isWindows && error.message.includes('Visual Studio')) {
    console.log('\n💡 Windows 编译错误解决方案:');
    console.log('   1. 安装 Visual Studio Build Tools:');
    console.log('      https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022');
    console.log('   2. 选择 "使用 C++ 的桌面开发" 工作负载');
    console.log('   3. 重新运行: pnpm run rebuild-native\n');
  } else {
    console.log('\n💡 尝试手动运行:');
    console.log('   1. pnpm install --frozen-lockfile');
    console.log('   2. pnpm run rebuild-native');
    console.log('   3. pnpm run dev:electron\n');
  }
  
  process.exit(1);
}
