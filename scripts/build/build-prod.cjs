#!/usr/bin/env node

/**
 * @file scripts/build/build-prod.cjs
 * @description 生产环境一键构建脚本
 * 
 * 这个脚本解决了以下问题：
 * 1. electron-builder 对某些“非扁平 node_modules”结构解析不稳定
 * 2. 需要在 dist_build 目录中使用 npm 创建扁平的 node_modules
 * 3. 自动化所有繁琐的手动步骤
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const {
  buildElectronBuilderArguments,
  inspectNativeBinaryTarget,
  resolveWindowsReleaseCommandRuntimeEnvironment,
  selectCompatibleNapiArtifact,
} = require('./functions/production-package-contract.cjs');

const rootDir = path.resolve(__dirname, '..', '..');
const distBuildDir = path.join(rootDir, 'dist_build');
/**
 * 镜像策略（基于已验证的根因）：
 * - Electron 安装仍默认走 npmmirror，加速主包下载；
 * - electron-builder 的辅助二进制（如 dmg-builder）默认走官方源。
 *
 * 根因说明：
 * - 当前 npmmirror 对 `dmg-builder@1.2.0` 资源返回 404（资源缺失）；
 * - 因此不能再把 builder 二进制强制指向 npmmirror，否则 mac 打包会稳定失败。
 *
 * 如需临时覆盖：
 * - ELECTRON_MIRROR
 * - ELECTRON_BUILDER_BINARIES_MIRROR
 */
const defaultElectronMirror = 'https://npmmirror.com/mirrors/electron/';
const electronMirror = process.env.ELECTRON_MIRROR || defaultElectronMirror;
const builderMirror = process.env.ELECTRON_BUILDER_BINARIES_MIRROR || '';
const electronVersion = require(path.join(rootDir, 'node_modules/electron/package.json')).version;

// 解析命令行参数以确定目标平台（必须在任何平台分支逻辑之前）
const args = process.argv.slice(2);
const isMac = args.includes('--mac');
// 默认为 Windows
const isWin = args.includes('--win') || !isMac;
// 本地验收包可显式使用 ad-hoc 签名；正式发布包仍使用证书与默认时间戳。
const disableMacTimestamp = isMac && args.includes('--no-timestamp');
const releaseTarget = isMac ? 'darwin-arm64' : 'win32-x64';
const bundleTraceDir = path.join(rootDir, 'dist_release', 'bundle-traces', releaseTarget);
const formalMacSigningIdentity = isMac && !disableMacTimestamp
  ? process.env.LINNYA_MAC_DMG_SIGN_IDENTITY || process.env.CSC_NAME || ''
  : undefined;
// 发布配置先于清理和编译冻结，避免缺证书或非法模式在长构建末尾才失败。
let buildArguments;
let commandRuntimeBuildEnvironment;
try {
  buildArguments = buildElectronBuilderArguments({
    platform: isMac ? 'darwin' : 'win32',
    architecture: isMac ? 'arm64' : 'x64',
    adHocMacSigning: disableMacTimestamp,
    macSigningIdentity: formalMacSigningIdentity,
  });
  commandRuntimeBuildEnvironment = isWin
    ? resolveWindowsReleaseCommandRuntimeEnvironment(process.env)
    : Object.freeze({});
} catch (error) {
  console.error(`❌ 生产构建配置无效: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

console.log('='.repeat(80));
console.log('🚀 开始生产环境构建');
console.log('='.repeat(80));

/**
 * 底层执行器：失败时抛错，由上层决定是否重试/退出
 */
function execOrThrow(command, cwd = rootDir, options = {}) {
  const { env = {}, unsetEnvKeys = [] } = options;
  console.log(`\n💻 执行: ${command}`);
  console.log(`📁 目录: ${cwd}\n`);

  const mergedEnv = { ...process.env, ...env };
  for (const key of unsetEnvKeys) {
    delete mergedEnv[key];
  }

  execSync(command, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: mergedEnv
  });
}

/**
 * 执行命令并实时显示输出（失败即退出）
 */
function exec(command, cwd = rootDir, options = {}) {
  try {
    execOrThrow(command, cwd, options);
  } catch {
    console.error(`\n❌ 命令执行失败: ${command}`);
    process.exit(1);
  }
}

function execFile(file, fileArgs, cwd = rootDir, options = {}) {
  const { env = {}, unsetEnvKeys = [] } = options;
  const mergedEnv = { ...process.env, ...env };
  for (const key of unsetEnvKeys) {
    delete mergedEnv[key];
  }
  console.log(`\n💻 执行: ${file} ${fileArgs.join(' ')}`);
  console.log(`📁 目录: ${cwd}\n`);
  try {
    execFileSync(file, fileArgs, { cwd, stdio: 'inherit', env: mergedEnv });
  } catch {
    console.error(`\n❌ 命令执行失败: ${file}`);
    process.exit(1);
  }
}

/**
 * 步骤 1: 清理旧的构建目录
 */
console.log('\n📦 步骤 1/8: 清理旧的构建目录...');
if (fs.existsSync(distBuildDir)) {
  try {
    fs.rmSync(distBuildDir, { recursive: true, force: true });
    console.log('✅ 清理完成');
  } catch (error) {
    console.error('❌ 清理失败:', error.message);
    console.log('\n💡 提示: 请关闭所有正在运行的应用实例，然后重试');
    process.exit(1);
  }
} else {
  console.log('✅ 无需清理（目录不存在）');
}
// build trace 是本次正式构建的外置证据；复用旧 trace 会把未执行的构建误报为已覆盖。
fs.rmSync(bundleTraceDir, { recursive: true, force: true });
fs.mkdirSync(bundleTraceDir, { recursive: true });
console.log(`✅ Bundle trace 目录已重建: ${path.relative(rootDir, bundleTraceDir)}`);

/**
 * 步骤 2: 运行标准构建准备
 */
console.log('\n📦 步骤 2/8: 运行构建准备脚本...');
exec('pnpm run build:electron:prepare', rootDir, {
  env: {
    LINNYA_BUILD_TARGET_PLATFORM: isMac ? 'darwin' : 'win32',
    LINNYA_BUILD_TARGET_ARCH: isMac ? 'arm64' : 'x64',
    // 只写到 dist_release；copy-files 不会把它复制进签名 App 或插件 ZIP。
    LINNYA_BUNDLE_TRACE_ROOT: bundleTraceDir,
  }
});

// 正式打包只能消费本次构建刚生成的完整 trace set；缺任一 Host 或正式插件
// target、输出 hash 漂移、绝对路径泄漏都会在进入 npm ci / 签名前失败。
execFile(process.execPath, [
  'scripts/build/bundle-trace/orchestration/generateBundleBuildTraceSet.mjs',
  `--trace-root=${bundleTraceDir}`,
  `--platform=${isMac ? 'darwin' : 'win32'}`,
  `--architecture=${isMac ? 'arm64' : 'x64'}`,
]);

/**
 * 步骤 3: 确认 packages 目录已复制
 */
console.log('\n📦 步骤 3/8: 验证本地包复制...');
const packagesDir = path.join(distBuildDir, 'packages');
if (fs.existsSync(packagesDir)) {
  console.log('✅ packages 目录已存在');
} else {
  console.error('❌ packages 目录缺失，构建准备脚本可能未正确执行');
  process.exit(1);
}

/**
 * 步骤 4: 在 dist_build 中安装生产依赖
 */
console.log('\n📦 步骤 4/8: 从冻结 lock 安装 dist_build 生产依赖...');
console.log('⏳ 这可能需要几分钟时间...');
exec('npm ci --omit=dev --no-audit --no-fund --ignore-scripts', distBuildDir);

/**
 * 步骤 5: 复制预编译的原生模块
 *
 * 目的：避免在 dist_build 里重新编译，直接复用根目录 `pnpm install` 时 postinstall
 * 产出的原生模块（`.node` 文件），从而加快生产构建速度。
 *
 * `@discordjs/opus` 是 N-API v3 模块，来源制品按 N-API、目标系统、目标架构选择，
 * 不能要求它已经位于 Electron ABI 目录。复制目标仍使用 Electron ABI 目录，因为
 * node-pre-gyp 的运行时加载器需要从该路径找到已经验真的兼容制品。
 */
console.log('\n📦 步骤 5/8: 复制预编译的原生模块...');
try {
  const nodeAbi = require('node-abi');

  let electronAbi;
  try {
    electronAbi = nodeAbi.getAbi(electronVersion, 'electron');
  } catch (e) {
    console.error('❌ 无法从 node-abi 推导 Electron ABI，无法确定 opus.node 预编译目录名');
    console.error(`   Electron version: ${electronVersion}`);
    console.error(`   错误信息: ${e && e.message ? e.message : String(e)}`);
    process.exit(1);
  }

  const targetPlatform = isMac ? 'darwin' : 'win32';
  const targetArchitecture = isMac ? 'arm64' : 'x64';
  const prebuildDirName = `electron-v${electronAbi}-napi-v3-${targetPlatform}-${targetArchitecture}-unknown-unknown`;
  const sourceFile = selectCompatibleNapiArtifact({
    prebuildDirectory: path.join(rootDir, 'node_modules/@discordjs/opus/prebuild'),
    napiVersion: 3,
    targetPlatform,
    targetArchitecture,
    moduleFileName: 'opus.node',
  });
  
  const targetDir = path.join(
    distBuildDir,
    'node_modules/@discordjs/opus/prebuild',
    prebuildDirName
  );
  const targetFile = path.join(targetDir, 'opus.node');

  if (!fs.existsSync(sourceFile)) {
    console.error(`❌ 预编译文件不存在: ${sourceFile}`);
    console.log('💡 请确保已在项目根目录成功运行 "pnpm install"，并且原生模块已编译。');
    console.log('💡 如果问题持续，请尝试删除根目录的 node_modules 后重新 pnpm install。');
    process.exit(1);
  }

  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(sourceFile, targetFile);
  console.log(`✅ 成功复制 opus.node 到构建目录`);
} catch (error) {
  console.error(`❌ 复制原生模块失败:`, error.message);
  process.exit(1);
}

/**
 * 步骤 5b: 收窄并验证 better-sqlite3 N-API 制品
 *
 * better-sqlite3 13 随包提供 N-API 10 平台制品。生产包只保留目标平台/架构，
 * 避免把其他操作系统的原生文件一并装入 asar.unpacked。
 */
console.log('\n📦 步骤 5b/8: 验证 better-sqlite3 目标平台制品...');
try {
  const expectedPlatform = isMac ? 'darwin' : 'win32';
  const expectedArchitecture = isMac ? 'arm64' : 'x64';
  const betterSqlitePrebuildDir = path.join(
    distBuildDir,
    'node_modules/better-sqlite3/prebuilds',
  );
  const expectedFileName = `${expectedPlatform}-${expectedArchitecture}.node`;
  const expectedFile = path.join(betterSqlitePrebuildDir, expectedFileName);

  if (!fs.existsSync(expectedFile)) {
    throw new Error(`未找到 better-sqlite3 目标平台制品：${expectedFile}`);
  }

  const actualTarget = inspectNativeBinaryTarget(expectedFile);
  if (
    actualTarget.platform !== expectedPlatform
    || actualTarget.architecture !== expectedArchitecture
  ) {
    throw new Error(
      `better-sqlite3 目标不匹配：构建需要 ${expectedPlatform}/${expectedArchitecture}，`
      + `当前制品是 ${actualTarget.platform}/${actualTarget.architecture}。`,
    );
  }

  for (const entry of fs.readdirSync(betterSqlitePrebuildDir)) {
    if (entry !== expectedFileName) {
      fs.rmSync(path.join(betterSqlitePrebuildDir, entry), { recursive: true, force: true });
    }
  }
  execOrThrow('pnpm run verify:better:runtimes', rootDir);
  console.log(`✅ better-sqlite3 生产制品已收窄为 ${expectedFileName}`);
} catch (error) {
  console.error('❌ 验证 better-sqlite3 失败:', error.message);
  process.exit(1);
}



/**
 * 步骤 6: 准备应用本地 VC++ 运行库 (仅 Windows)
 *
 * 系统级 vc_redist 会触发 UAC，违反按用户安装合同。正式构建从已授权的
 * Visual Studio Build Tools 可再分发目录取文件，并把同一套 DLL 放到应用 exe 旁。
 */
if (isWin) {
  console.log('\n📦 步骤 6/8: 准备应用本地 VC++ 运行库...');
  execFile('node', [
    'scripts/build/prepare-windows-app-local-runtime.cjs',
    '--project-dir',
    distBuildDir,
    '--arch',
    'x64',
  ]);
}

/**
 * 步骤 7: 收窄 node-pty 发布内容
 *
 * 必须放在最后一次 npm install 之后。npm 会重新整理嵌套依赖；提前裁剪会让
 * node-addon-api 等仅构建时依赖再次进入发布树。macOS 只保留本次目标架构，
 * Windows 使用 Linnya 自有 ConPTY owner，不发布 node-pty。
 */
console.log('\n📦 步骤 7/8: 准备 node-pty 目标平台运行时...');
exec(
  `node scripts/build/commands/prepare-node-pty-runtime.cjs --project-dir "${distBuildDir}" --platform ${isMac ? 'darwin' : 'win32'} --arch ${isMac ? 'arm64' : 'x64'}`,
  rootDir,
);

/**
 * 步骤 8: 运行 electron-builder 打包
 */
console.log('\n📦 步骤 8/8: 运行 electron-builder 打包...');
console.log('⏳ 这可能需要几分钟时间...');


if (isMac) {
  if (disableMacTimestamp) {
    console.log('⚠️ mac 签名模式: ad-hoc identity=-，不请求时间戳（--no-timestamp）');
  } else {
    console.log('✅ mac 签名模式: 使用正式签名配置和默认时间戳');
  }
  console.log('🍏 目标平台: macOS (arm64)');
} else {
  console.log('🪟 目标平台: Windows (x64)');
}

// Windows 的 release 模式与精确发布者已在清理构建目录前共同冻结；afterSign
// 继续检查真实签名产物，不能再依赖子进程碰巧继承另一半发布配置。

if (builderMirror) {
  console.log(`🌐 Builder 镜像: ${builderMirror}`);
  execFile('pnpm', buildArguments, rootDir, {
    // 清理 npm 注入值；Electron 主包仍使用上方显式冻结的镜像。
    unsetEnvKeys: [
      'npm_config_electron_mirror',
      'NPM_CONFIG_ELECTRON_MIRROR'
    ],
    env: {
      ...commandRuntimeBuildEnvironment,
      ELECTRON_MIRROR: electronMirror,
      ELECTRON_BUILDER_BINARIES_MIRROR: builderMirror
    }
  });
} else {
  console.log('🌐 Builder 二进制源: 官方源（未设置 ELECTRON_BUILDER_BINARIES_MIRROR）');
  execFile('pnpm', buildArguments, rootDir, {
    // 即使未显式设置 builder 镜像，也要清理 npm 注入的 electron_mirror，避免误路由到 npmmirror
    unsetEnvKeys: [
      'npm_config_electron_mirror',
      'NPM_CONFIG_ELECTRON_MIRROR',
      'ELECTRON_BUILDER_BINARIES_MIRROR',
      'npm_config_electron_builder_binaries_mirror',
      'NPM_CONFIG_ELECTRON_BUILDER_BINARIES_MIRROR'
    ],
    env: {
      ...commandRuntimeBuildEnvironment,
      ELECTRON_MIRROR: electronMirror,
    }
  });
}

/**
 * 步骤 9（仅 mac）: 使用 create-dmg 生成 DMG
 *
 * 根因说明：
 * - electron-builder 内置的 dmg-builder 需要从 GitHub 下载 ~20MB 的 Python 运行时（dmgbuild-bundle）；
 * - 在国内网络环境下该下载极不稳定（socket hang up / 404），且缓存机制不透明；
 * - 因此改用 brew install create-dmg 提供的本地工具生成 DMG，彻底消除外部下载依赖。
 */
if (isMac) {
  console.log('\n📦 步骤 9: 使用 create-dmg 生成 DMG...');
  const createDmgScript = path.join(rootDir, 'scripts/build/create-dmg.sh');
  if (fs.existsSync(createDmgScript)) {
    exec(`bash "${createDmgScript}"`, rootDir, {
      env: {
        LINNYA_MAC_DMG_SIGN_IDENTITY: disableMacTimestamp ? '-' : formalMacSigningIdentity,
        LINNYA_MAC_DMG_ALLOW_AD_HOC: disableMacTimestamp ? '1' : '0',
      },
    });
  } else {
    console.error('❌ 未找到 scripts/build/create-dmg.sh，无法生成 macOS DMG。');
    process.exit(1);
  }
}

/**
 * 最终步骤：从签名后的应用目录与最终发行文件生成内容 BOM。
 *
 * BOM 必须放在安装包旁边，不能写回已经签名的应用，否则既会破坏签名，也会形成
 * “BOM hash 安装包、BOM 又改变安装包”的自引用循环。
 */
console.log('\n📦 最终步骤: 生成 Desktop artifact 内容 BOM...');
execFile(process.execPath, [
  '--import',
  'tsx',
  'scripts/release/orchestration/generateDesktopArtifactContentBom.ts',
  `--platform=${isMac ? 'darwin' : 'win32'}`,
  `--architecture=${isMac ? 'arm64' : 'x64'}`,
]);

// package map 只对已经写入 content BOM 的真实 app.asar 做身份归因。它不能提前从
// node_modules 猜最终布局，也不会把编译 bundle 或原生 runtime 冒充成已完成的法律 SBOM。
console.log('\n📦 最终步骤: 生成 Desktop artifact package map...');
execFile(process.execPath, [
  '--import',
  'tsx',
  'scripts/release/orchestration/generateDesktopArtifactPackageMap.ts',
  `--platform=${isMac ? 'darwin' : 'win32'}`,
  `--architecture=${isMac ? 'arm64' : 'x64'}`,
]);

// Bundle component map 只接受本次 trace set，并按最终 artifact 文件 hash 建立 occurrence。
// 这一步既不能从源码依赖图猜 bundle，也不能把未分发的中间文件算成成品。
console.log('\n📦 最终步骤: 生成 Desktop artifact bundle component map...');
execFile(process.execPath, [
  '--import',
  'tsx',
  'scripts/release/orchestration/generateDesktopArtifactBundleComponentMap.ts',
  `--platform=${isMac ? 'darwin' : 'win32'}`,
  `--architecture=${isMac ? 'arm64' : 'x64'}`,
  `--trace-root=${bundleTraceDir}`,
]);

// 法律 evidence 只消费最终 package map 与冻结 npm 安装树；它不会把 Linnya 自有
// workspace package 误列成第三方，也不会把尚未归因的 bundle/runtime 偷换成已完成。
console.log('\n📦 最终步骤: 生成 Desktop artifact package 法律 evidence...');
execFile(process.execPath, [
  '--import',
  'tsx',
  'scripts/release/orchestration/generateDesktopArtifactPackageLegalEvidence.ts',
  `--platform=${isMac ? 'darwin' : 'win32'}`,
  `--architecture=${isMac ? 'arm64' : 'x64'}`,
]);

/**
 * 完成！
 */
console.log('\n' + '='.repeat(80));
console.log('🎉 构建完成！');
console.log('='.repeat(80));
console.log(`\n📁 安装包位置: ${path.join(distBuildDir, 'dist_electron')}`);
console.log('\n');
