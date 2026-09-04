import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createAfterSignRuntimeAssetsHook } = require(
  '../../../../build/after-sign-runtime-assets.cjs',
);
const sandboxRuntimeCatalog = require(
  '../../../../config/headless-node-runtime.json',
);

const temporaryRoots = [];

async function createPackagedRuntime(artifactBytes = Buffer.from('unsigned-runtime')) {
  const appOutDir = await fsp.mkdtemp(path.join(tmpdir(), 'linnya-after-sign-'));
  temporaryRoots.push(appOutDir);
  const runtimeDirectory = path.join(
    appOutDir,
    'resources/command-runtime/windows/x64',
  );
  await fsp.mkdir(runtimeDirectory, { recursive: true });
  const artifactPath = path.join(runtimeDirectory, 'linnyaCommandProcessOwner.node');
  const manifestPath = path.join(
    runtimeDirectory,
    'linnyaCommandProcessOwner.manifest.json',
  );
  const vcRuntimeDirectories = [
    appOutDir,
    runtimeDirectory,
    path.join(appOutDir, 'resources/bin/qdrant'),
  ];
  await Promise.all(vcRuntimeDirectories.map(directory => fsp.mkdir(directory, { recursive: true })));
  await Promise.all(vcRuntimeDirectories.flatMap(directory => [
    fsp.writeFile(path.join(directory, 'msvcp140.dll'), 'microsoft-msvcp-runtime'),
    fsp.writeFile(path.join(directory, 'vcruntime140.dll'), 'microsoft-vc-runtime'),
    fsp.writeFile(path.join(directory, 'vcruntime140_1.dll'), 'microsoft-vc-runtime-one'),
  ]));
  await Promise.all([
    fsp.writeFile(artifactPath, artifactBytes),
    fsp.writeFile(manifestPath, `${JSON.stringify({
      schema_version: 1,
      runtime_id: 'linnya_command_process_owner',
      runtime_version: '0.1.0',
      application_version: '0.0.38',
      platform: 'win32',
      architecture: 'x64',
      minimum_node_api_version: 8,
      binding_contract_version: 1,
      signature_evidence: { kind: 'development_unsigned' },
      artifact: {
        file_name: 'linnyaCommandProcessOwner.node',
        size_bytes: artifactBytes.byteLength,
        sha256: createHash('sha256').update(artifactBytes).digest('hex'),
      },
    }, null, 2)}\n`),
  ]);
  const sandboxTarget = sandboxRuntimeCatalog.targets.find(target => (
    target.platform === 'win32' && target.architecture === 'x64'
  ));
  if (!sandboxTarget) throw new Error('Windows Sandbox runtime test target is missing');
  const sandboxRuntimeDirectory = path.join(
    appOutDir,
    'resources/headless-node-runtime/win32/x64',
  );
  const sandboxEvaluatorDirectory = path.join(
    appOutDir,
    'resources/sandbox-runtime/evaluator',
  );
  await Promise.all([
    fsp.mkdir(sandboxRuntimeDirectory, { recursive: true }),
    fsp.mkdir(sandboxEvaluatorDirectory, { recursive: true }),
  ]);
  const sandboxNodePath = path.join(sandboxRuntimeDirectory, 'node.exe');
  const sandboxNodeBytes = Buffer.from('signed-sandbox-node');
  await Promise.all([
    fsp.writeFile(sandboxNodePath, sandboxNodeBytes),
    fsp.writeFile(path.join(sandboxRuntimeDirectory, 'LICENSE'), 'Node license\n'),
    fsp.writeFile(
      path.join(sandboxEvaluatorDirectory, 'sandboxEvaluatorProcess.cjs'),
      'process.exit(0);\n',
    ),
    fsp.writeFile(path.join(sandboxRuntimeDirectory, 'runtime-manifest.json'), `${JSON.stringify({
      schema_version: 1,
      runtime_id: 'linnya_headless_node_runtime',
      node_version: sandboxRuntimeCatalog.node_version,
      platform: 'win32',
      architecture: 'x64',
      distribution: {
        archive_file_name: sandboxTarget.archive_file_name,
        archive_sha256: sandboxTarget.archive_sha256,
      },
      prepared_executable: {
        relative_path: sandboxTarget.executable_relative_path,
        size_bytes: sandboxNodeBytes.byteLength,
        sha256: createHash('sha256').update(sandboxNodeBytes).digest('hex'),
      },
    }, null, 2)}\n`),
  ]);
  return {
    artifactPath,
    manifestPath,
    sandboxNodePath,
    context: {
      electronPlatformName: 'win32',
      appOutDir,
      packager: { appInfo: { version: '0.0.38' } },
    },
  };
}

async function createPackagedMacNodePty() {
  const appOutDir = await fsp.mkdtemp(path.join(tmpdir(), 'linnya-after-sign-mac-'));
  temporaryRoots.push(appOutDir);
  const appPath = path.join(appOutDir, 'Linnya.app');
  const nodePtyRoot = path.join(
    appPath,
    'Contents/Resources/app.asar.unpacked/node_modules/node-pty',
  );
  const nativeRoot = path.join(nodePtyRoot, 'prebuilds/darwin-arm64');
  const libRoot = path.join(nodePtyRoot, 'lib');
  await Promise.all([
    fsp.mkdir(nativeRoot, { recursive: true }),
    fsp.mkdir(libRoot, { recursive: true }),
  ]);
  const addonPath = path.join(nativeRoot, 'pty.node');
  const helperPath = path.join(nativeRoot, 'spawn-helper');
  await Promise.all([
    fsp.writeFile(path.join(nodePtyRoot, 'package.json'), JSON.stringify({
      name: 'node-pty',
      version: '1.2.0-beta.14',
      license: 'MIT',
    })),
    fsp.writeFile(path.join(nodePtyRoot, 'LICENSE'), 'MIT license\n'),
    ...[
      'eventEmitter2.js',
      'index.js',
      'interfaces.js',
      'terminal.js',
      'types.js',
      'unixTerminal.js',
      'utils.js',
    ].map(fileName => fsp.writeFile(path.join(libRoot, fileName), 'module.exports = {}\n')),
    fsp.writeFile(addonPath, 'signed-addon', { mode: 0o644 }),
    fsp.writeFile(helperPath, 'signed-helper', { mode: 0o755 }),
  ]);
  const sandboxTarget = sandboxRuntimeCatalog.targets.find(target => (
    target.platform === 'darwin' && target.architecture === 'arm64'
  ));
  if (!sandboxTarget) throw new Error('macOS Sandbox runtime test target is missing');
  const resourcesDirectory = path.join(appPath, 'Contents/Resources');
  const sandboxRuntimeDirectory = path.join(
    resourcesDirectory,
    'headless-node-runtime/darwin/arm64',
  );
  const sandboxEvaluatorDirectory = path.join(
    resourcesDirectory,
    'sandbox-runtime/evaluator',
  );
  await Promise.all([
    fsp.mkdir(path.join(sandboxRuntimeDirectory, 'bin'), { recursive: true }),
    fsp.mkdir(sandboxEvaluatorDirectory, { recursive: true }),
  ]);
  const sandboxNodePath = path.join(sandboxRuntimeDirectory, 'bin/node');
  const sandboxNodeBytes = Buffer.from('signed-sandbox-node');
  await Promise.all([
    fsp.writeFile(sandboxNodePath, sandboxNodeBytes, { mode: 0o755 }),
    fsp.writeFile(path.join(sandboxRuntimeDirectory, 'LICENSE'), 'Node license\n'),
    fsp.writeFile(
      path.join(sandboxEvaluatorDirectory, 'sandboxEvaluatorProcess.cjs'),
      'process.exit(0);\n',
    ),
    fsp.writeFile(path.join(sandboxRuntimeDirectory, 'runtime-manifest.json'), `${JSON.stringify({
      schema_version: 1,
      runtime_id: 'linnya_headless_node_runtime',
      node_version: sandboxRuntimeCatalog.node_version,
      platform: 'darwin',
      architecture: 'arm64',
      distribution: {
        archive_file_name: sandboxTarget.archive_file_name,
        archive_sha256: sandboxTarget.archive_sha256,
      },
      prepared_executable: {
        relative_path: sandboxTarget.executable_relative_path,
        size_bytes: sandboxNodeBytes.byteLength,
        sha256: createHash('sha256').update(sandboxNodeBytes).digest('hex'),
      },
    }, null, 2)}\n`),
  ]);
  return {
    appPath,
    addonPath,
    helperPath,
    sandboxNodePath,
    context: {
      electronPlatformName: 'darwin',
      arch: 3,
      appOutDir,
      packager: { appInfo: { productFilename: 'Linnya' } },
    },
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => (
    fsp.rm(root, { recursive: true, force: true })
  )));
});

describe('Windows command runtime afterSign trust contract', () => {
  const validVcRuntimeInspector = async () => ({
    status: 'Valid',
    status_message: 'Signature verified.',
    publisher_identity: 'CN=Microsoft Corporation, O=Microsoft Corporation, C=US',
  });

  it('开发构建明确验证未签名制品，并保留 development manifest', async () => {
    const runtime = await createPackagedRuntime();
    const hook = createAfterSignRuntimeAssetsHook({
      hostPlatform: 'win32',
      environment: {
        LINNYA_WINDOWS_COMMAND_RUNTIME_BUILD_TRUST: 'development',
      },
      authenticodeInspector: async () => ({
        status: 'NotSigned',
        status_message: 'The file is not digitally signed.',
        publisher_identity: null,
      }),
      windowsVcRuntimeAuthenticodeInspector: validVcRuntimeInspector,
    });

    await hook(runtime.context);

    const manifest = JSON.parse(await fsp.readFile(runtime.manifestPath, 'utf8'));
    expect(manifest.signature_evidence).toEqual({ kind: 'development_unsigned' });
  });

  it('开发构建拒绝意外签名或打包后 byte 漂移', async () => {
    const signedRuntime = await createPackagedRuntime();
    const signedHook = createAfterSignRuntimeAssetsHook({
      hostPlatform: 'win32',
      environment: {
        LINNYA_WINDOWS_COMMAND_RUNTIME_BUILD_TRUST: 'development',
      },
      authenticodeInspector: async () => ({
        status: 'Valid',
        status_message: 'Signature verified.',
        publisher_identity: 'CN=Unexpected',
      }),
      windowsVcRuntimeAuthenticodeInspector: validVcRuntimeInspector,
    });
    await expect(signedHook(signedRuntime.context)).rejects.toThrow(
      'must remain unsigned',
    );

    const changedRuntime = await createPackagedRuntime();
    await fsp.appendFile(changedRuntime.artifactPath, '-changed');
    const unsignedHook = createAfterSignRuntimeAssetsHook({
      hostPlatform: 'win32',
      environment: {
        LINNYA_WINDOWS_COMMAND_RUNTIME_BUILD_TRUST: 'development',
      },
      authenticodeInspector: async () => ({
        status: 'NotSigned',
        status_message: 'The file is not digitally signed.',
        publisher_identity: null,
      }),
      windowsVcRuntimeAuthenticodeInspector: validVcRuntimeInspector,
    });
    await expect(unsignedHook(changedRuntime.context)).rejects.toThrow(
      'changed after its manifest was generated',
    );
  });

  it('发布构建必须显式提供精确发布者，不能因配置缺失降级', async () => {
    const runtime = await createPackagedRuntime();
    const missingModeHook = createAfterSignRuntimeAssetsHook({
      hostPlatform: 'win32',
      environment: {},
      windowsVcRuntimeAuthenticodeInspector: validVcRuntimeInspector,
    });
    await expect(missingModeHook(runtime.context)).rejects.toThrow(
      'must be explicitly set to development or release',
    );

    const missingPublisherHook = createAfterSignRuntimeAssetsHook({
      hostPlatform: 'win32',
      environment: {
        LINNYA_WINDOWS_COMMAND_RUNTIME_BUILD_TRUST: 'release',
      },
      windowsVcRuntimeAuthenticodeInspector: validVcRuntimeInspector,
    });
    await expect(missingPublisherHook(runtime.context)).rejects.toThrow(
      'is required for a release Windows build',
    );
  });

  it('发布构建拒绝错误发布者，只在精确匹配后写入最终 hash', async () => {
    const runtime = await createPackagedRuntime(Buffer.from('signed-runtime-bytes'));
    const wrongPublisherHook = createAfterSignRuntimeAssetsHook({
      hostPlatform: 'win32',
      environment: {
        LINNYA_WINDOWS_COMMAND_RUNTIME_BUILD_TRUST: 'release',
        LINNYA_WINDOWS_EXPECTED_PUBLISHER_IDENTITY: 'CN=Linnya Release',
      },
      authenticodeInspector: async () => ({
        status: 'Valid',
        status_message: 'Signature verified.',
        publisher_identity: 'CN=Another Publisher',
      }),
      windowsVcRuntimeAuthenticodeInspector: validVcRuntimeInspector,
    });
    await expect(wrongPublisherHook(runtime.context)).rejects.toThrow(
      'Authenticode publisher mismatch',
    );

    const hook = createAfterSignRuntimeAssetsHook({
      hostPlatform: 'win32',
      environment: {
        LINNYA_WINDOWS_COMMAND_RUNTIME_BUILD_TRUST: 'release',
        LINNYA_WINDOWS_EXPECTED_PUBLISHER_IDENTITY: 'CN=Linnya Release',
      },
      authenticodeInspector: async artifactPath => {
        expect(artifactPath).toBe(runtime.artifactPath);
        return {
          status: 'Valid',
          status_message: 'Signature verified.',
          publisher_identity: 'CN=Linnya Release',
        };
      },
      windowsVcRuntimeAuthenticodeInspector: validVcRuntimeInspector,
    });

    await hook(runtime.context);

    const [artifactBytes, manifest] = await Promise.all([
      fsp.readFile(runtime.artifactPath),
      fsp.readFile(runtime.manifestPath, 'utf8').then(JSON.parse),
    ]);
    expect(manifest.signature_evidence).toEqual({
      kind: 'authenticode_build_verified',
      publisher_identity: 'CN=Linnya Release',
    });
    expect(manifest.artifact).toEqual({
      file_name: 'linnyaCommandProcessOwner.node',
      size_bytes: artifactBytes.byteLength,
      sha256: createHash('sha256').update(artifactBytes).digest('hex'),
    });
  });

  it('拒绝最终包漏复制或混入不同版本的应用本地运行库', async () => {
    const missingRuntime = await createPackagedRuntime();
    await fsp.rm(path.join(missingRuntime.context.appOutDir, 'resources/bin/qdrant/vcruntime140_1.dll'));
    const hook = createAfterSignRuntimeAssetsHook({
      hostPlatform: 'win32',
      environment: { LINNYA_WINDOWS_COMMAND_RUNTIME_BUILD_TRUST: 'development' },
      authenticodeInspector: async () => ({
        status: 'NotSigned',
        status_message: 'The file is not digitally signed.',
        publisher_identity: null,
      }),
      windowsVcRuntimeAuthenticodeInspector: validVcRuntimeInspector,
    });
    await expect(hook(missingRuntime.context)).rejects.toThrow(/vcruntime140_1\.dll/u);

    const mixedRuntime = await createPackagedRuntime();
    await fsp.writeFile(
      path.join(mixedRuntime.context.appOutDir, 'resources/bin/qdrant/msvcp140.dll'),
      'different-runtime-version',
    );
    await expect(hook(mixedRuntime.context)).rejects.toThrow('differs between load locations');
  });

  it('非 macOS/Windows 目标不读取平台信任配置', async () => {
    const hook = createAfterSignRuntimeAssetsHook({
      hostPlatform: 'darwin',
      environment: {},
    });
    await expect(hook({ electronPlatformName: 'linux' })).resolves.toBeUndefined();
  });
});

describe('macOS runtime assets afterSign contract', () => {
  it('只读验收目标架构、可执行权限和与 App 相同的签名身份', async () => {
    const runtime = await createPackagedMacNodePty();
    const inspectedSignatures = [];
    const hook = createAfterSignRuntimeAssetsHook({
      hostPlatform: 'darwin',
      macArchitectureInspector: async filePath => {
        expect([runtime.addonPath, runtime.helperPath, runtime.sandboxNodePath]).toContain(filePath);
        return ['arm64'];
      },
      macCodeSignatureInspector: async (filePath, deep) => {
        inspectedSignatures.push({ filePath, deep });
        return { teamIdentifier: 'TEAM123' };
      },
    });

    await hook(runtime.context);

    expect(inspectedSignatures).toEqual(expect.arrayContaining([
      { filePath: runtime.appPath, deep: true },
      { filePath: runtime.addonPath, deep: false },
      { filePath: runtime.helperPath, deep: false },
      { filePath: runtime.sandboxNodePath, deep: false },
    ]));
    expect(await fsp.readFile(runtime.addonPath, 'utf8')).toBe('signed-addon');
    expect(await fsp.readFile(runtime.helperPath, 'utf8')).toBe('signed-helper');
  });

  it('拒绝错误架构和与 App 不同的 helper 签名身份', async () => {
    const wrongArchitecture = await createPackagedMacNodePty();
    const architectureHook = createAfterSignRuntimeAssetsHook({
      hostPlatform: 'darwin',
      macArchitectureInspector: async () => ['x64'],
      macCodeSignatureInspector: async () => ({ teamIdentifier: 'TEAM123' }),
    });
    await expect(architectureHook(wrongArchitecture.context)).rejects.toThrow(
      'native architecture mismatch',
    );

    const wrongTeam = await createPackagedMacNodePty();
    const teamHook = createAfterSignRuntimeAssetsHook({
      hostPlatform: 'darwin',
      macArchitectureInspector: async () => ['arm64'],
      macCodeSignatureInspector: async filePath => ({
        teamIdentifier: filePath === wrongTeam.helperPath ? 'OTHER_TEAM' : 'TEAM123',
      }),
    });
    await expect(teamHook(wrongTeam.context)).rejects.toThrow(
      'spawn-helper TeamIdentifier does not match',
    );
  });

  it('Sandbox runtime manifest 或 evaluator bundle 缺失时拒绝产出正式包', async () => {
    const missingManifest = await createPackagedMacNodePty();
    await fsp.rm(path.join(
      missingManifest.appPath,
      'Contents/Resources/headless-node-runtime/darwin/arm64/runtime-manifest.json',
    ));
    const hook = createAfterSignRuntimeAssetsHook({
      hostPlatform: 'darwin',
      macArchitectureInspector: async () => ['arm64'],
      macCodeSignatureInspector: async () => ({ teamIdentifier: 'TEAM123' }),
    });
    await expect(hook(missingManifest.context)).rejects.toMatchObject({ code: 'ENOENT' });

    const missingEvaluator = await createPackagedMacNodePty();
    await fsp.rm(path.join(
      missingEvaluator.appPath,
      'Contents/Resources/sandbox-runtime/evaluator/sandboxEvaluatorProcess.cjs',
    ));
    await expect(hook(missingEvaluator.context)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
