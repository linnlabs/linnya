import * as fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  assertWindowsVcRuntimeAuthenticode,
  buildElectronBuilderArguments,
  prepareWindowsAppLocalRuntime,
  resolveWindowsReleaseCommandRuntimeEnvironment,
  resolveWindowsVcRuntimeSource,
  selectCompatibleNapiArtifact,
} = require('../production-package-contract.cjs');
const temporaryRoots = [];

function createThinMachO(architecture) {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(architecture === 'arm64' ? 0x0100000c : 0x01000007, 4);
  return header;
}

function createPe(architecture) {
  const header = Buffer.alloc(128);
  header.write('MZ', 0, 'ascii');
  header.writeUInt32LE(64, 0x3c);
  header.write('PE\0\0', 64, 'ascii');
  header.writeUInt16LE(architecture === 'arm64' ? 0xaa64 : 0x8664, 68);
  return header;
}

async function createPrebuild(directoryName, binary) {
  const root = temporaryRoots[0] ?? await fsp.mkdtemp(path.join(tmpdir(), 'linnya-opus-prebuild-'));
  if (temporaryRoots.length === 0) temporaryRoots.push(root);
  const directory = path.join(root, directoryName);
  await fsp.mkdir(directory, { recursive: true });
  await fsp.writeFile(path.join(directory, 'opus.node'), binary);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => fsp.rm(root, { recursive: true, force: true })));
});

describe('production native artifact contract', () => {
  it('按 N-API 兼容性选择制品，不要求来源目录使用 Electron ABI', async () => {
    const prebuildDirectory = await createPrebuild(
      'node-v127-napi-v3-darwin-arm64-unknown-unknown',
      createThinMachO('arm64'),
    );
    expect(selectCompatibleNapiArtifact({
      prebuildDirectory,
      napiVersion: 3,
      targetPlatform: 'darwin',
      targetArchitecture: 'arm64',
      moduleFileName: 'opus.node',
    })).toContain('node-v127-napi-v3-darwin-arm64-unknown-unknown');
  });

  it('拒绝目录目标与原生文件头不一致，也不借用其它平台或架构', async () => {
    const prebuildDirectory = await createPrebuild(
      'node-v127-napi-v3-darwin-arm64-unknown-unknown',
      createThinMachO('x64'),
    );
    await createPrebuild('node-v127-napi-v3-win32-x64-unknown-unknown', createPe('x64'));
    expect(() => selectCompatibleNapiArtifact({
      prebuildDirectory,
      napiVersion: 3,
      targetPlatform: 'darwin',
      targetArchitecture: 'arm64',
      moduleFileName: 'opus.node',
    })).toThrow('expected darwin/arm64, got darwin/x64');
    expect(() => selectCompatibleNapiArtifact({
      prebuildDirectory,
      napiVersion: 3,
      targetPlatform: 'win32',
      targetArchitecture: 'arm64',
      moduleFileName: 'opus.node',
    })).toThrow('No N-API v3 artifact for win32/arm64');
  });

  it('使用 PE 文件头验真 Windows x64 制品', async () => {
    const prebuildDirectory = await createPrebuild(
      'node-v127-napi-v3-win32-x64-unknown-unknown',
      createPe('x64'),
    );
    expect(selectCompatibleNapiArtifact({
      prebuildDirectory,
      napiVersion: 3,
      targetPlatform: 'win32',
      targetArchitecture: 'x64',
      moduleFileName: 'opus.node',
    })).toContain('win32-x64');
  });
});

describe('electron-builder production command contract', () => {
  it('Windows 正式入口在构建前冻结 release 与精确发布者', () => {
    expect(resolveWindowsReleaseCommandRuntimeEnvironment({
      LINNYA_WINDOWS_EXPECTED_PUBLISHER_IDENTITY: 'CN=Linnya Release',
    })).toEqual({
      LINNYA_WINDOWS_COMMAND_RUNTIME_BUILD_TRUST: 'release',
      LINNYA_WINDOWS_EXPECTED_PUBLISHER_IDENTITY: 'CN=Linnya Release',
    });
    for (const environment of [
      {},
      { LINNYA_WINDOWS_EXPECTED_PUBLISHER_IDENTITY: '' },
      { LINNYA_WINDOWS_EXPECTED_PUBLISHER_IDENTITY: '   ' },
    ]) {
      expect(() => resolveWindowsReleaseCommandRuntimeEnvironment(environment))
        .toThrow('is required for a release Windows build');
    }
  });

  it('macOS ad-hoc 构建显式使用 identity=- 和合法的无时间戳配置', () => {
    const argumentsList = buildElectronBuilderArguments({
      platform: 'darwin',
      architecture: 'arm64',
      adHocMacSigning: true,
      macSigningIdentity: undefined,
    });
    expect(argumentsList).toContain('--config.mac.identity=-');
    expect(argumentsList).toContain('--config.mac.timestamp=none');
    expect(argumentsList).toContain('--config.npmRebuild=false');
    expect(argumentsList.join(' ')).not.toContain('timestamp=false');
  });

  it('正常签名和 Windows 构建不注入 ad-hoc 配置', () => {
    const macArguments = buildElectronBuilderArguments({
      platform: 'darwin',
      architecture: 'arm64',
      adHocMacSigning: false,
      macSigningIdentity: 'Developer ID Application: Linnya Example (TEAMID)',
    });
    const windowsArguments = buildElectronBuilderArguments({
      platform: 'win32', architecture: 'x64', adHocMacSigning: false,
    });
    expect(macArguments).toContain(
      '--config.mac.identity=Developer ID Application: Linnya Example (TEAMID)',
    );
    expect(windowsArguments.some(argument => argument.startsWith('--config.mac.'))).toBe(false);
    expect(macArguments).toContain('--config.npmRebuild=false');
    expect(windowsArguments).toContain('--config.npmRebuild=false');
    expect(() => buildElectronBuilderArguments({
      platform: 'win32', architecture: 'x64', adHocMacSigning: true,
    })).toThrow('only be used for a macOS build');
    for (const macSigningIdentity of [undefined, '-']) {
      expect(() => buildElectronBuilderArguments({
        platform: 'darwin',
        architecture: 'arm64',
        adHocMacSigning: false,
        macSigningIdentity,
      })).toThrow('require a non-ad-hoc signing identity');
    }
  });
});

describe('Windows app-local VC runtime contract', () => {
  it('从当前 Build Tools 的唯一 CRT 目录解析来源，也允许发布机显式指定来源', async () => {
    const root = await fsp.mkdtemp(path.join(tmpdir(), 'linnya-vc-redist-source-'));
    temporaryRoots.push(root);
    const automaticSource = path.join(root, 'x64', 'Microsoft.VC143.CRT');
    const explicitSource = path.join(root, 'approved-runtime');
    await Promise.all([
      fsp.mkdir(automaticSource, { recursive: true }),
      fsp.mkdir(explicitSource, { recursive: true }),
    ]);

    expect(resolveWindowsVcRuntimeSource({
      environment: { VCToolsRedistDir: root },
      architecture: 'x64',
    })).toBe(automaticSource);
    expect(resolveWindowsVcRuntimeSource({
      environment: { LINNYA_WINDOWS_VC_RUNTIME_DIR: explicitSource },
      architecture: 'x64',
    })).toBe(explicitSource);
  });

  it('验真全部 DLL 后整体替换暂存目录，拒绝缺文件和错误架构', async () => {
    const root = await fsp.mkdtemp(path.join(tmpdir(), 'linnya-vc-runtime-copy-'));
    temporaryRoots.push(root);
    const sourceDirectory = path.join(root, 'source');
    const targetDirectory = path.join(root, 'target');
    await Promise.all([fsp.mkdir(sourceDirectory), fsp.mkdir(targetDirectory)]);
    await Promise.all([
      fsp.writeFile(path.join(sourceDirectory, 'msvcp140.dll'), createPe('x64')),
      fsp.writeFile(path.join(sourceDirectory, 'vcruntime140.dll'), createPe('x64')),
      fsp.writeFile(path.join(sourceDirectory, 'vcruntime140_1.dll'), createPe('x64')),
      fsp.writeFile(path.join(targetDirectory, 'stale-runtime.dll'), createPe('x64')),
    ]);

    expect(prepareWindowsAppLocalRuntime({
      sourceDirectory,
      targetDirectory,
      architecture: 'x64',
    })).toEqual(['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']);
    expect((await fsp.readdir(targetDirectory)).sort()).toEqual([
      'msvcp140.dll',
      'vcruntime140.dll',
      'vcruntime140_1.dll',
    ]);

    await fsp.writeFile(path.join(sourceDirectory, 'vcruntime140.dll'), createPe('arm64'));
    expect(() => prepareWindowsAppLocalRuntime({
      sourceDirectory,
      targetDirectory,
      architecture: 'x64',
    })).toThrow('expected win32/x64, got win32/arm64');
    expect((await fsp.readdir(targetDirectory)).sort()).toEqual([
      'msvcp140.dll',
      'vcruntime140.dll',
      'vcruntime140_1.dll',
    ]);

    await fsp.writeFile(path.join(sourceDirectory, 'vcruntime140.dll'), createPe('x64'));
    expect(() => prepareWindowsAppLocalRuntime({
      sourceDirectory,
      targetDirectory,
      architecture: 'x64',
      verifySourceFile: filePath => {
        if (filePath.endsWith('vcruntime140.dll')) throw new Error('invalid source signature');
      },
    })).toThrow('invalid source signature');
    expect((await fsp.readdir(targetDirectory)).sort()).toEqual([
      'msvcp140.dll',
      'vcruntime140.dll',
      'vcruntime140_1.dll',
    ]);
  });

  it('发布配置只允许当前用户安装，并把运行库放到每个独立加载位置', async () => {
    const packageConfig = JSON.parse(await fsp.readFile(
      path.resolve(import.meta.dirname, '..', '..', '..', '..', 'package.json'),
      'utf8',
    ));
    expect(packageConfig.build.nsis).toMatchObject({
      oneClick: true,
      perMachine: false,
      allowElevation: false,
      include: 'build/installer.nsh',
    });
    expect(packageConfig.build.win.extraFiles).toContainEqual({
      from: 'build/windows-app-local-runtime/x64',
      to: '.',
      filter: ['*.dll'],
    });
    for (const targetDirectory of [
      'command-runtime/windows/x64',
      'bin/qdrant',
    ]) {
      expect(packageConfig.build.win.extraResources).toContainEqual({
        from: 'build/windows-app-local-runtime/x64',
        to: targetDirectory,
        filter: ['*.dll'],
      });
    }
    expect(packageConfig.build.win.extraResources).toContainEqual({
      from: 'dist/main/plugin-cli-runtime/win32/x64/linnya-plugin-cli-client.exe',
      to: 'command-runtime/plugin-cli/win32/x64/linnya-plugin-cli-client.exe',
    });
    expect(packageConfig.build.mac.extraResources).toContainEqual({
      from: 'dist/main/plugin-cli-runtime/darwin/arm64/linnya-plugin-cli-client',
      to: 'command-runtime/plugin-cli/darwin/arm64/linnya-plugin-cli-client',
    });
    expect(packageConfig.build.win.extraResources).toContainEqual({
      from: '../extraResources/headless-node-runtime/win32/x64',
      to: 'headless-node-runtime/win32/x64',
    });
    expect(packageConfig.build.mac.extraResources).toContainEqual({
      from: '../extraResources/headless-node-runtime/darwin/arm64',
      to: 'headless-node-runtime/darwin/arm64',
    });
    expect(packageConfig.build.extraResources).toContainEqual({
      from: 'dist/main/sandbox/sandboxEvaluatorProcess.cjs',
      to: 'sandbox-runtime/evaluator/sandboxEvaluatorProcess.cjs',
    });
    expect(packageConfig.build.afterSign).toBe('build/after-sign-runtime-assets.cjs');
    expect(JSON.stringify(packageConfig.build)).not.toContain(
      '--linnya-internal-sandbox-runner',
    );
    for (const platformConfig of [packageConfig.build.win, packageConfig.build.mac]) {
      const pluginCliResource = platformConfig.extraResources.find(resource => (
        resource.to?.includes('command-runtime/plugin-cli/')
      ));
      expect(pluginCliResource?.from).not.toMatch(/^dist\/main\/commands\//u);
    }
    expect(JSON.stringify(packageConfig.build.win)).not.toContain('vc_redist');
  });

  it('只接受 Microsoft Corporation 的有效 Authenticode 签名', () => {
    expect(() => assertWindowsVcRuntimeAuthenticode({
      filePath: 'C:\\runtime\\vcruntime140.dll',
      status: 'Valid',
      subject: 'CN=Microsoft Corporation, O=Microsoft Corporation, C=US',
    })).not.toThrow();
    expect(() => assertWindowsVcRuntimeAuthenticode({
      filePath: 'C:\\runtime\\vcruntime140.dll',
      status: 'NotSigned',
      subject: '',
    })).toThrow('signature is not valid');
    expect(() => assertWindowsVcRuntimeAuthenticode({
      filePath: 'C:\\runtime\\vcruntime140.dll',
      status: 'Valid',
      subject: 'CN=Example Corporation, C=US',
    })).toThrow('signer is not Microsoft Corporation');
    expect(() => assertWindowsVcRuntimeAuthenticode({
      filePath: 'C:\\runtime\\vcruntime140.dll',
      status: 'Valid',
      subject: undefined,
    })).toThrow('signer is not Microsoft Corporation');
  });
});
