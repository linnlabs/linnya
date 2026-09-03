#!/usr/bin/env node

/**
 * 为 Electron 重新编译原生模块
 * 
 * 这个脚本会：
 * 1. 使用 electron-rebuild 重新编译 @discordjs/opus
 * 2. 将编译好的 .node 文件复制到正确的位置
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const detectLibc = require('detect-libc');
const nodeAbi = require('node-abi');
const {
  inspectNativeBinaryTarget,
  selectCompatibleNapiArtifact,
} = require('../build/functions/production-package-contract.cjs');

const rootDir = path.resolve(__dirname, '..', '..');
const electronRebuildRunner = path.join(__dirname, 'run-electron-rebuild.cjs');

console.log('🔨 开始为 Electron 重新编译原生模块...\n');

// 1. 运行 electron-rebuild
console.log('📦 重新编译 @discordjs/opus...');
execFileSync(process.execPath, [electronRebuildRunner, '@discordjs/opus'], {
  stdio: 'inherit',
  cwd: rootDir,
});
console.log('✅ 编译完成\n');

// 2. 获取 Electron 版本
const electronVersion = require('electron/package.json').version;
/**
 * 重要：这里不能用 Electron 的“版本号”（例如 35.7）去拼 `electron-v35.7-*` 目录名。
 *
 * `@discordjs/opus` 使用 `@discordjs/node-pre-gyp`，其 `{node_abi}` 规则来自 `node-abi`：
 * - Node.js: `node-v127`（示例）
 * - Electron: `electron-v${ABI}-${platform}-${arch}-${libc}`
 *
 * 也就是说目录名里的 `electron-vXXX` 是 ABI，不是 Electron 的版本号。
 */
let electronAbi;
try {
  electronAbi = nodeAbi.getAbi(electronVersion, 'electron');
} catch (e) {
  throw new Error(
    `node-abi 无法解析 Electron ${electronVersion}：${e && e.message ? e.message : String(e)}`,
  );
}

/**
 * 确定 libc / libc_version（仅 Linux 有意义）。
 * `@discordjs/opus` 的 `binary.module_path` 会把它们放进目录名里：
 *   ./prebuild/{node_abi}-napi-v{napi_build_version}-{platform}-{arch}-{libc}-{libc_version}/
 */
let libc = 'unknown';
let libcVersion = 'unknown';
if (process.platform === 'linux') {
  // detect-libc: family() => 'glibc' | 'musl' | null
  const family = detectLibc.familySync();
  const version = detectLibc.versionSync();
  libc = family || 'unknown';
  libcVersion = version || 'unknown';
}

console.log('🧩 原生模块重编译目标信息：');
console.log(`   - Electron 版本: ${electronVersion}`);
console.log(`   - Electron ABI: electron-v${electronAbi}`);
console.log(`   - 平台/架构: ${process.platform}/${process.arch}`);
console.log(`   - libc: ${libc} (${libcVersion})\n`);

/**
 * 确定源文件和目标文件路径
 */
const platform = process.platform;
const arch = process.arch;
const buildDir = path.join(rootDir, 'node_modules/@discordjs/opus/build-tmp-napi-v3/Release');
const legacySourceFile = path.join(buildDir, 'opus.node');
const prebuildRoot = path.join(rootDir, 'node_modules/@discordjs/opus/prebuild');
const expectedDirPrefix = `electron-v${electronAbi}-napi-v3-${platform}-${arch}-`;
const expectedDirName = `${expectedDirPrefix}${libc}-${libcVersion}`;
const expectedDir = path.join(prebuildRoot, expectedDirName);
const expectedFile = path.join(expectedDir, 'opus.node');

console.log('📌 预期的 opus.node 位置（node-pre-gyp 目录规则）：');
console.log(`   - 目录: ${expectedDirName}`);
console.log(`   - 文件: ${expectedFile}\n`);

/**
 * 4. 查找编译后的文件
 */
let sourceFile = legacySourceFile;
if (fs.existsSync(sourceFile)) {
  const actualTarget = inspectNativeBinaryTarget(sourceFile);
  if (actualTarget.platform !== platform || actualTarget.architecture !== arch) {
    throw new Error(
      `electron-rebuild output target mismatch: expected ${platform}/${arch}, `
      + `got ${actualTarget.platform}/${actualTarget.architecture}: ${sourceFile}`,
    );
  }
} else if (fs.existsSync(prebuildRoot)) {
  sourceFile = selectCompatibleNapiArtifact({
    prebuildDirectory: prebuildRoot,
    napiVersion: 3,
    targetPlatform: platform,
    targetArchitecture: arch,
    moduleFileName: 'opus.node',
  });
  console.log(`🧩 使用 N-API v3 兼容制品: ${path.relative(prebuildRoot, sourceFile)}`);
}

if (!fs.existsSync(sourceFile)) {
  console.error('❌ 编译后的文件不存在:', sourceFile);
  console.log(`🔎 调试信息：Electron=${electronVersion}, ABI=electron-v${electronAbi}, platform=${platform}, arch=${arch}, libc=${libc}, libc_version=${libcVersion}`);
  if (fs.existsSync(prebuildRoot)) {
    const entries = fs.readdirSync(prebuildRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    console.log(`🔎 prebuild 目录下的候选项（目录）：${entries.length ? entries.join(', ') : '(空)'}`);
  } else {
    console.log('🔎 prebuild 目录不存在');
  }
  throw new Error('@discordjs/opus 是生产依赖，目标平台制品缺失时不能继续安装。');
}

/**
 * 5. 创建目标目录并复制文件
 */
console.log(`📁 创建目标目录: ${path.basename(expectedDir)}`);
fs.mkdirSync(expectedDir, { recursive: true });

console.log('📋 复制 opus.node 到预编译目录...');
if (path.resolve(sourceFile) !== path.resolve(expectedFile)) {
  fs.copyFileSync(sourceFile, expectedFile);
}

for (const entry of fs.readdirSync(prebuildRoot, { withFileTypes: true })) {
  if (
    entry.isDirectory()
    && entry.name.startsWith('electron-v')
    && entry.name.includes(`-${platform}-${arch}-`)
    && entry.name !== expectedDirName
  ) {
    fs.rmSync(path.join(prebuildRoot, entry.name), { recursive: true, force: true });
    console.log(`🧹 删除旧 Electron ABI 目录: ${entry.name}`);
  }
}

/**
 * 6. 验证
 */
const stats = fs.statSync(expectedFile);
console.log(`✅ 完成！文件大小: ${(stats.size / 1024).toFixed(0)} KB`);
console.log(`📍 位置: ${expectedFile}\n`);

console.log('🎉 所有原生模块已成功重新编译并配置！');
