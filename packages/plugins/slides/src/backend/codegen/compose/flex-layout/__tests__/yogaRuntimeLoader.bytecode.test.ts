import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

function readElectronBinaryPath(): string {
  const electronBinaryPath: unknown = require('electron');
  if (typeof electronBinaryPath !== 'string') {
    throw new Error('electron 包未返回可执行文件路径。');
  }
  return electronBinaryPath;
}

describe('yogaRuntimeLoader bytecode compatibility', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('loads yoga-layout from a bytenode module through the CJS helper', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoga-bytecode-'));
    tempDirs.push(tempDir);

    const sourcePath = path.join(tempDir, 'entry.js');
    const bytecodePath = path.join(tempDir, 'entry.jsc');
    const helperPath = path.resolve(__dirname, '..', 'yogaRuntimeLoader.cjs');

    fs.writeFileSync(sourcePath, [
      `const { loadYoga } = require(${JSON.stringify(helperPath)});`,
      '(async () => {',
      '  const yoga = await loadYoga();',
      "  console.log('helper-loaded', typeof yoga.Node);",
      '})().catch((err) => {',
      '  console.error(err);',
      '  process.exit(1);',
      '});',
      '',
    ].join('\n'));

    await execFileAsync(process.execPath, [
      '-e',
      [
        "const bytenode = require('bytenode');",
        `bytenode.compileFile({ filename: ${JSON.stringify(sourcePath)}, output: ${JSON.stringify(bytecodePath)} })`,
        ".then(() => process.exit(0))",
        ".catch((err) => { console.error(err); process.exit(1); });",
      ].join(''),
    ], {
      cwd: process.cwd(),
    });

    const runResult = await execFileAsync(process.execPath, [
      '-e',
      [
        "require('bytenode');",
        `require(${JSON.stringify(bytecodePath)});`,
      ].join(''),
    ], {
      cwd: process.cwd(),
    });

    expect(runResult.stdout).toContain('helper-loaded function');
    // vm.USE_MAIN_CONTEXT_DEFAULT_LOADER 会输出 ExperimentalWarning，属于正常行为
    const stderrWithoutWarnings = runResult.stderr.replace(/\(node:\d+\) ExperimentalWarning:.*\n.*/g, '').trim();
    expect(stderrWithoutWarnings).toBe('');
  });

  it('loads yoga-layout through the helper under Electron with v8-compile-cache enabled', async () => {
    const helperPath = path.resolve(__dirname, '..', 'yogaRuntimeLoader.cjs');
    const electronBinaryPath = readElectronBinaryPath();

    const runResult = await execFileAsync(electronBinaryPath, [
      '-e',
      [
        "require('v8-compile-cache');",
        `const { loadYoga } = require(${JSON.stringify(helperPath)});`,
        '(async () => {',
        '  const yoga = await loadYoga();',
        "  console.log('helper-loaded-with-cache', typeof yoga.Node);",
        '})().catch((err) => {',
        '  console.error(err);',
        '  process.exit(1);',
        '});',
      ].join(''),
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
      },
    });

    expect(runResult.stdout).toContain('helper-loaded-with-cache function');
    const stderrWithoutWarnings = runResult.stderr.replace(/\(.*?\d+\) ExperimentalWarning:.*\n.*/g, '').trim();
    expect(stderrWithoutWarnings).toBe('');
  });

  it('loads yoga-layout when Module._compile is patched without importModuleDynamically (NativeCompileCache)', async () => {
    // 模拟 Electron Main 字节码加载链替换 `_compile` 的行为：
    // 替换 Module._compile，用 vm.Script 编译但不传 importModuleDynamically
    const helperPath = path.resolve(__dirname, '..', 'yogaRuntimeLoader.cjs');

    const testScript = [
      "const Module = require('module');",
      "const vm = require('vm');",
      "const path = require('path');",
      '',
      '// 模拟 NativeCompileCache：覆盖 _compile，不传 importModuleDynamically',
      'const _original = Module.prototype._compile;',
      'Module.prototype._compile = function(content, filename) {',
      '  const wrapper = Module.wrap(content);',
      '  const script = new vm.Script(wrapper, {',
      '    filename,',
      '    lineOffset: 0,',
      '    displayErrors: true,',
      '    // 故意不传 importModuleDynamically，复现 NativeCompileCache 的行为',
      '  });',
      '  const compiledWrapper = script.runInThisContext({ filename });',
      '  const dirname = path.dirname(filename);',
      '  const args = [this.exports, require, this, filename, dirname, process, global, Buffer];',
      '  return compiledWrapper.apply(this.exports, args);',
      '};',
      '',
      `const { loadYoga } = require(${JSON.stringify(helperPath)});`,
      '(async () => {',
      '  const yoga = await loadYoga();',
      "  console.log('ncc-patched-loaded', typeof yoga.Node);",
      '})().catch((err) => {',
      '  console.error(err);',
      '  process.exit(1);',
      '});',
    ].join('\n');

    const runResult = await execFileAsync(process.execPath, ['-e', testScript], {
      cwd: process.cwd(),
    });

    expect(runResult.stdout).toContain('ncc-patched-loaded function');
    const stderrWithoutWarnings = runResult.stderr.replace(/\(node:\d+\) ExperimentalWarning:.*\n.*/g, '').trim();
    expect(stderrWithoutWarnings).toBe('');
  });

  it('loads yoga-layout from plugin-local node_modules when running outside the repo root', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoga-artifact-local-'));
    tempDirs.push(tempDir);

    const artifactBackendDir = path.join(tempDir, 'dist/backend');
    const artifactNodeModulesDir = path.join(artifactBackendDir, 'node_modules');
    const helperPath = path.join(artifactBackendDir, 'yogaRuntimeLoader.cjs');
    const yogaPackageDir = path.resolve(path.dirname(require.resolve('yoga-layout/load')), '../..');

    fs.mkdirSync(artifactNodeModulesDir, { recursive: true });
    fs.copyFileSync(path.resolve(__dirname, '..', 'yogaRuntimeLoader.cjs'), helperPath);
    fs.cpSync(yogaPackageDir, path.join(artifactNodeModulesDir, 'yoga-layout'), {
      recursive: true,
    });

    const runResult = await execFileAsync(process.execPath, [
      '-e',
      [
        `const { loadYoga } = require(${JSON.stringify(helperPath)});`,
        '(async () => {',
        '  const yoga = await loadYoga();',
        "  console.log('artifact-local-loaded', typeof yoga.Node);",
        '})().catch((err) => {',
        '  console.error(err);',
        '  process.exit(1);',
        '});',
      ].join(''),
    ], {
      cwd: os.tmpdir(),
    });

    expect(runResult.stdout).toContain('artifact-local-loaded function');
    const stderrWithoutWarnings = runResult.stderr.replace(/\(node:\d+\) ExperimentalWarning:.*\n.*/g, '').trim();
    expect(stderrWithoutWarnings).toBe('');
  });
});
