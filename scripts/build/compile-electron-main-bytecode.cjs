#!/usr/bin/env node

/**
 * 在与生产加载环境相同的 Electron Main Process 中生成 Bytenode 字节码。
 * Electron 42+ 的 Main 与 ELECTRON_RUN_AS_NODE 使用不同 V8 snapshot，不能混编。
 */

const fs = require('node:fs');
const path = require('node:path');
const bytenode = require('bytenode');

const rootDir = path.resolve(__dirname, '..', '..');
const [sourceArgument, outputArgument] = process.argv.slice(2);

if (!sourceArgument || !outputArgument) {
  throw new Error('用法：node scripts/build/compile-electron-main-bytecode.cjs <source> <output>');
}

const sourcePath = path.resolve(rootDir, sourceArgument);
const outputPath = path.resolve(rootDir, outputArgument);

if (!fs.existsSync(sourcePath)) {
  throw new Error(`[bytecode] 源文件不存在：${sourcePath}`);
}

async function main() {
  // Bytenode 会把当前环境传给编译用 Electron；必须确保它启动为真实 Main Process。
  delete process.env.ELECTRON_RUN_AS_NODE;

  const compiledPath = await bytenode.compileFile({
    filename: sourcePath,
    output: outputPath,
    electronMain: true,
    electronPath: require('electron'),
  });

  if (path.resolve(compiledPath) !== outputPath || !fs.existsSync(outputPath)) {
    throw new Error(`[bytecode] Electron Main Process 未生成预期产物：${outputPath}`);
  }

  if (process.env.LINNYA_BUNDLE_TRACE_ROOT) {
    const { writeDerivedBundleTrace } = await import(
      './bundle-trace/functions/bundleBuildTrace.mjs'
    );
    writeDerivedBundleTrace({
      buildTarget: 'desktop/main-bytecode',
      inputPath: sourcePath,
      outputPath,
      repositoryRoot: rootDir,
      toolName: 'bytenode',
      toolVersion: require('bytenode/package.json').version,
    });
  }

  console.log(`[bytecode] Electron Main Process 编译完成：${path.relative(rootDir, outputPath)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
