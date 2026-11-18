import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import sharp from 'sharp';
import {
  projectProductionPackageManifest,
  projectPackagedSchemasManifest,
} from '../../../build/functions/productionPackageManifest.mjs';
import { assertProductionPackageLock } from '../../../build/functions/productionPackageLock.mjs';

const require = createRequire(import.meta.url);
const {
  prepareWindowsAppLocalRuntime,
} = require('../../../build/functions/production-package-contract.cjs');

export const repositoryRoot = path.resolve(import.meta.dirname, '../../../..');
export const executableName = 'Linnya Knowledge Acceptance.exe';

export async function runCommand(
  file,
  args,
  { cwd = repositoryRoot, env = process.env, timeout = 20 * 60_000, inherit = true } = {}
) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let errors = '';
    child.stdout?.on('data', value => {
      output = `${output}${value}`.slice(-1_000_000);
    });
    child.stderr?.on('data', value => {
      errors = `${errors}${value}`.slice(-1_000_000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(
          new Error(`${file} ${args[0] ?? ''} failed (${code ?? signal}): ${errors}\n${output}`)
        );
      else resolve(output.trim());
    });
  });
}

const json = async file => JSON.parse(await readFile(file, 'utf8'));
const writeJson = (file, data) => writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
export const hashFile = async file =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');

/** 真正 Host 的 JS/Renderer/插件与安装目录布局；不生成 NSIS、发行清单或假字节码。 */
export async function prepareWindowsCandidate(root) {
  const vcRuntimeSource = process.env.LINNYA_WINDOWS_VC_RUNTIME_DIR;
  assert.ok(
    vcRuntimeSource && path.isAbsolute(vcRuntimeSource),
    'Set LINNYA_WINDOWS_VC_RUNTIME_DIR to the verified Visual Studio x64 CRT directory'
  );
  const vcRuntimeDirectory = path.join(root, 'vc-runtime');
  const runtimeFiles = prepareWindowsAppLocalRuntime({
    sourceDirectory: vcRuntimeSource,
    targetDirectory: vcRuntimeDirectory,
    architecture: 'x64',
  });
  const sourceCommit = await runCommand('git', ['rev-parse', 'HEAD'], { inherit: false });
  assert.equal(
    await runCommand('git', ['status', '--porcelain'], { inherit: false }),
    '',
    'Commit the exact acceptance source before building'
  );
  const environment = {
    ...process.env,
    LINNYA_BUILD_TARGET_PLATFORM: 'win32',
    LINNYA_BUILD_TARGET_ARCH: 'x64',
  };
  delete environment.LINNYA_DESKTOP_DISTRIBUTION_MANIFEST;
  delete environment.LINNYA_BUNDLED_PLUGIN_ROOT;
  for (const script of ['package:plugins:official', 'prepare:extra-resources']) {
    await runCommand('pnpm', ['run', script], { env: environment });
  }
  await runCommand(
    process.execPath,
    ['scripts/build/prepare-qdrant-runtime.cjs', '--allow-cross-target'],
    { env: environment }
  );
  await runCommand(
    process.execPath,
    ['scripts/build/prepare-headless-node-runtime.cjs', '--allow-cross-target'],
    { env: environment }
  );
  for (const script of [
    'clean:build',
    'build:wasm',
    'build:frontend',
    'build:main',
    'build:preload',
    'build:measurement-worker',
    'build:measurement-preload',
    'build:worker',
    'build:backend',
    'build:windows-command-native-runtime',
  ]) {
    await runCommand('pnpm', ['run', script], { env: environment });
  }
  await runCommand(process.execPath, ['scripts/build/copy-measurement-worker-assets.js']);

  const application = path.join(root, 'application');
  const resources = path.join(root, 'resources');
  const output = path.join(root, 'output');
  await mkdir(application, { recursive: true });
  await mkdir(resources, { recursive: true });
  const sourceManifest = await json(path.join(repositoryRoot, 'package.json'));
  const electronZip = process.env.LINNYA_WINDOWS_ELECTRON_ZIP;
  let electronZipIdentity;
  if (electronZip) {
    const name = `electron-v${sourceManifest.devDependencies.electron}-win32-x64.zip`;
    assert.ok(path.isAbsolute(electronZip));
    assert.equal(path.basename(electronZip), name);
    const checksumUrl = `https://github.com/electron/electron/releases/download/v${sourceManifest.devDependencies.electron}/SHASUMS256.txt`;
    const checksums = await runCommand(
      'curl',
      [
        '--fail',
        '--location',
        '--connect-timeout',
        '8',
        '--max-time',
        '30',
        '--silent',
        '--show-error',
        checksumUrl,
      ],
      { inherit: false, timeout: 35_000 }
    );
    const entry = checksums
      .split(/\r?\n/)
      .map(line => line.trim().split(/\s+\*?/))
      .find(fields => fields[1] === name);
    assert.ok(entry && /^[a-f0-9]{64}$/.test(entry[0]), 'Official Electron checksum missing');
    const sha256 = await hashFile(electronZip);
    assert.equal(sha256, entry[0], 'Explicit Electron ZIP differs from the official release');
    electronZipIdentity = { name, sha256, checksumUrl };
  }
  const manifest = projectProductionPackageManifest(sourceManifest);
  const lock = await json(path.join(repositoryRoot, 'production-package-lock.json'));
  assertProductionPackageLock(lock, manifest);
  manifest.main = 'dist/main/main.cjs';
  const sourceBuild = sourceManifest.build;
  // 仅变更验收包装入口和输出；真正 App 仍自行解析 packaged/community 身份与随包来源。
  manifest.build = {
    appId: 'dev.linnya.acceptance.knowledge',
    productName: 'Linnya Knowledge Acceptance',
    electronVersion: sourceManifest.devDependencies.electron,
    ...(electronZip ? { electronDist: electronZip } : {}),
    electronFuses: sourceBuild.electronFuses,
    asar: true,
    asarUnpack: sourceBuild.asarUnpack,
    npmRebuild: false,
    nodeGypRebuild: false,
    files: sourceBuild.files.filter(file => typeof file === 'string'),
    directories: { output },
    win: {
      target: [{ target: 'dir', arch: ['x64'] }],
      signAndEditExecutable: false,
      files: sourceBuild.win.files,
    },
    extraResources: [
      { from: path.join(resources, 'plugins'), to: 'plugins' },
      { from: path.join(resources, 'node'), to: 'headless-node-runtime/win32/x64' },
      { from: path.join(resources, 'qdrant'), to: 'bin/qdrant' },
      {
        from: path.join(application, 'dist/main/commands/runtime/windows/x64'),
        to: 'command-runtime/windows/x64',
      },
      {
        from: path.join(application, 'dist/main/plugin-cli-runtime/win32/x64'),
        to: 'command-runtime/plugin-cli/win32/x64',
      },
      {
        from: path.join(application, 'dist/main/sandbox/sandboxEvaluatorProcess.cjs'),
        to: 'sandbox-runtime/evaluator/sandboxEvaluatorProcess.cjs',
      },
    ],
  };
  await writeJson(path.join(application, 'package.json'), manifest);
  await writeJson(path.join(application, 'package-lock.json'), lock);
  await cp(path.join(repositoryRoot, 'dist'), path.join(application, 'dist'), { recursive: true });
  const schemaRoot = path.join(application, 'packages/schemas');
  await mkdir(schemaRoot, { recursive: true });
  await writeJson(
    path.join(schemaRoot, 'package.json'),
    projectPackagedSchemasManifest(
      await json(path.join(repositoryRoot, 'packages/schemas/package.json'))
    )
  );
  await cp(path.join(repositoryRoot, 'packages/schemas/dist'), path.join(schemaRoot, 'dist'), {
    recursive: true,
  });
  await cp(
    path.join(repositoryRoot, 'packages/parser-wasm/pkg-node'),
    path.join(application, 'packages/parser-wasm/pkg-node'),
    { recursive: true }
  );
  await cp(
    path.join(repositoryRoot, 'src/features/skills/builtin/skills'),
    path.join(application, 'dist/builtin-skills'),
    { recursive: true }
  );
  const catalogDirectory = path.join(application, 'dist/domains/model-catalog');
  await mkdir(catalogDirectory, { recursive: true });
  const catalog = await json(
    path.join(
      repositoryRoot,
      'src/domains/model-catalog/features/default-catalog/assets/default_models.json'
    )
  );
  // 本轮配置完全由合成协议场景创建，不把源码开发 mock 模型预置到安装目录。
  await writeJson(path.join(catalogDirectory, 'default_models.json'), { ...catalog, models: [] });
  await cp(path.join(repositoryRoot, 'extraResources/plugins'), path.join(resources, 'plugins'), {
    recursive: true,
  });
  await cp(
    path.join(repositoryRoot, 'extraResources/headless-node-runtime/win32/x64'),
    path.join(resources, 'node'),
    { recursive: true }
  );
  await cp(
    path.join(repositoryRoot, 'extraResources/bin/qdrant/win-x64'),
    path.join(resources, 'qdrant'),
    { recursive: true }
  );
  await runCommand(
    'npm',
    ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--os=win32', '--cpu=x64'],
    { cwd: application }
  );
  await stat(path.join(application, 'node_modules/better-sqlite3/prebuilds/win32-x64.node'));
  const packagingEnvironment = { ...environment, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
  delete packagingEnvironment.CSC_LINK;
  delete packagingEnvironment.CSC_KEY_PASSWORD;
  await runCommand(
    'pnpm',
    [
      'exec',
      'electron-builder',
      '--projectDir',
      application,
      '--win',
      '--x64',
      '--dir',
      '--publish',
      'never',
    ],
    { env: packagingEnvironment }
  );
  const unpacked = path.join(output, 'win-unpacked');
  await stat(path.join(unpacked, executableName));
  // 与正式安装包相同的 app-local CRT；真实微软签名由 Windows 上的 afterSign 验证。
  for (const relativeDirectory of [
    '.',
    'resources/command-runtime/windows/x64',
    'resources/bin/qdrant',
  ]) {
    const targetDirectory = path.join(unpacked, relativeDirectory);
    await mkdir(targetDirectory, { recursive: true });
    for (const name of runtimeFiles)
      await cp(path.join(vcRuntimeDirectory, name), path.join(targetDirectory, name));
  }
  const finalizationFiles = [
    'build/after-sign-runtime-assets.cjs',
    'build/windows-vc-runtime-trust.cjs',
    'config/headless-node-runtime.json',
  ];
  const finalization = path.join(root, 'finalization');
  for (const file of finalizationFiles) {
    const target = path.join(finalization, file);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(repositoryRoot, file), target);
  }
  const scenario = path.join(root, 'scenario.mjs');
  await build({
    entryPoints: [path.join(import.meta.dirname, 'windowsScenario.mjs')],
    outfile: scenario,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    bundle: true,
    logLevel: 'warning',
  });
  const pixels = sharp(Buffer.from([255, 0, 0, 255, 0, 0, 0, 0]), {
    raw: { width: 2, height: 1, channels: 4 },
  });
  const images = {};
  for (const format of ['png', 'jpeg', 'webp', 'gif'])
    images[format] = (await pixels.clone().toFormat(format).toBuffer()).toString('base64');
  await writeJson(path.join(root, 'images.json'), images);
  const knowledgeManifest = await json(
    path.join(repositoryRoot, 'packages/plugins/knowledge/plugin.json')
  );
  const candidate = {
    sourceCommit,
    sourceTree: await runCommand('git', ['rev-parse', 'HEAD^{tree}'], { inherit: false }),
    version: manifest.version,
    electron: sourceManifest.devDependencies.electron,
    ...(electronZipIdentity ? { electronZipIdentity } : {}),
    kind: 'community-installation-layout',
    main: manifest.main,
    coverage:
      'Real App and plugin artifact; not NSIS installation, release bytecode or production publication',
    productionLockSha256: await hashFile(path.join(repositoryRoot, 'production-package-lock.json')),
    scenarioSha256: await hashFile(scenario),
    unsignedFinalization: {
      mode: 'release_unsigned',
      files: await Promise.all(
        finalizationFiles.map(async file => ({
          file,
          sha256: await hashFile(path.join(finalization, file)),
        }))
      ),
      vcRuntime: await Promise.all(
        runtimeFiles.map(async file => ({
          file,
          sha256: await hashFile(path.join(vcRuntimeDirectory, file)),
        }))
      ),
    },
    pluginZipSha256: await hashFile(
      path.join(
        repositoryRoot,
        `packages/plugins/knowledge/dist/artifacts/knowledge-${knowledgeManifest.version}.zip`
      )
    ),
    appAsarSha256: await hashFile(path.join(unpacked, 'resources/app.asar')),
    nodeSha256: await hashFile(
      path.join(unpacked, 'resources/headless-node-runtime/win32/x64/node.exe')
    ),
    qdrantSha256: await hashFile(path.join(unpacked, 'resources/bin/qdrant/qdrant.exe')),
    bootstrapSha256: await hashFile(
      path.join(unpacked, 'resources/app.asar.unpacked/dist/plugin-runtime.worker.cjs')
    ),
  };
  await writeJson(path.join(root, 'candidate.json'), candidate);
  assert.equal(await runCommand('git', ['rev-parse', 'HEAD'], { inherit: false }), sourceCommit);
  assert.equal(await runCommand('git', ['status', '--porcelain'], { inherit: false }), '');
  return { candidate, unpacked, scenario, finalization };
}
