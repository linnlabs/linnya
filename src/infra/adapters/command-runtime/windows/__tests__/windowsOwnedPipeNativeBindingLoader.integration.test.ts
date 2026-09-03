import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  WINDOWS_OWNED_PIPE_NATIVE_ARTIFACT_FILE_NAME,
  WINDOWS_OWNED_PIPE_NATIVE_MANIFEST_FILE_NAME,
  WindowsNativeRuntimeLoadError,
} from '../../../local-process-runtime/windows/definitions/windowsNativeRuntimeManifest';
import {
  createWindowsOwnedPipeNativeBindingLoader,
  type WindowsOwnedPipeNativeBindingLoaderOptions,
} from '../../../local-process-runtime/windows/functions/loadWindowsOwnedPipeNativeBinding';
import { createWindowsOwnedPtyNativeBindingLoader } from '../functions/loadWindowsOwnedPtyNativeBinding';

const RUNTIME_VERSION = '0.1.0';
const APPLICATION_VERSION = '0.0.38';
const PUBLISHER_IDENTITY = 'CN=Linnya Test Publisher';
const ARTIFACT_BYTES = Buffer.from('native-addon-fixture');

interface FixturePaths {
  readonly directory: string;
  readonly manifestPath: string;
  readonly artifactPath: string;
}

function createManifest(
  bytes: Uint8Array = ARTIFACT_BYTES,
): Record<string, unknown> {
  return {
    schema_version: 1,
    runtime_id: 'linnya_command_process_owner',
    runtime_version: RUNTIME_VERSION,
    application_version: APPLICATION_VERSION,
    platform: 'win32',
    architecture: 'x64',
    minimum_node_api_version: 8,
    binding_contract_version: 1,
    signature_evidence: { kind: 'development_unsigned' },
    artifact: {
      file_name: WINDOWS_OWNED_PIPE_NATIVE_ARTIFACT_FILE_NAME,
      size_bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

function createNativeModule(options?: {
  readonly onPtyWrite?: (data: Buffer) => void;
  readonly acceptedPtyBytes?: number;
}): object {
  return {
    createWindowsOwnedPipeProcess() {
      return {
        startObservers() {},
        resumeAfterObserversReady() {},
        resumeOutput() {},
        cancelOutput() {},
        async terminateAndWaitTreeEmpty() {},
        async release() {},
      };
    },
    createWindowsOwnedPtyProcess() {
      return {
        startObservers() {},
        resumeAfterObserversReady() {},
        async writeInput(data: Buffer) {
          options?.onPtyWrite?.(data);
          return options?.acceptedPtyBytes ?? data.byteLength;
        },
        resize() {},
        resumeOutput() {},
        cancelOutput() {},
        async terminateAndWaitTreeEmpty() {},
        async release() {},
      };
    },
  };
}

function createLoaderOptions(
  manifestPath: string,
  loadNativeModule: (artifactPath: string) => unknown,
): WindowsOwnedPipeNativeBindingLoaderOptions {
  return {
    manifestPath,
    expectedRuntimeVersion: RUNTIME_VERSION,
    expectedApplicationVersion: APPLICATION_VERSION,
    trust: { kind: 'development' },
    runtimeFacts: {
      platform: 'win32',
      architecture: 'x64',
      nodeApiVersion: '8',
    },
    loadNativeModule,
  };
}

async function expectLoadError(
  load: () => Promise<unknown>,
  code: WindowsNativeRuntimeLoadError['code'],
): Promise<void> {
  try {
    await load();
  } catch (error) {
    expect(error).toBeInstanceOf(WindowsNativeRuntimeLoadError);
    if (!(error instanceof WindowsNativeRuntimeLoadError)) return;
    expect(error.code).toBe(code);
    return;
  }
  throw new Error(`expected Windows native runtime load error: ${code}`);
}

describe('Windows owned-pipe native runtime manifest loader', () => {
  let root: string;
  let fixtureSequence = 0;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-win-runtime-loader-'));
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  async function writeFixture(
    manifest: unknown = createManifest(),
    bytes: Uint8Array = ARTIFACT_BYTES,
  ): Promise<FixturePaths> {
    fixtureSequence += 1;
    const directory = path.join(root, `fixture-${fixtureSequence}`);
    await fsp.mkdir(directory, { recursive: true });
    const manifestPath = path.join(
      directory,
      WINDOWS_OWNED_PIPE_NATIVE_MANIFEST_FILE_NAME,
    );
    const artifactPath = path.join(
      directory,
      WINDOWS_OWNED_PIPE_NATIVE_ARTIFACT_FILE_NAME,
    );
    await Promise.all([
      fsp.writeFile(manifestPath, JSON.stringify(manifest)),
      fsp.writeFile(artifactPath, bytes),
    ]);
    return { directory, manifestPath, artifactPath };
  }

  it('固定启动装配事实，只验证一次相邻制品，并保持 native 异步清理合同', async () => {
    const fixture = await writeFixture({
      ...createManifest(),
      signature_evidence: {
        kind: 'authenticode_build_verified',
        publisher_identity: PUBLISHER_IDENTITY,
      },
    });
    const loadedPaths: string[] = [];
    const mutableTrust: {
      kind: 'release';
      expectedPublisherIdentity: string;
    } = {
      kind: 'release',
      expectedPublisherIdentity: PUBLISHER_IDENTITY,
    };
    const mutableFacts: {
      platform: NodeJS.Platform;
      architecture: string;
      nodeApiVersion: string | undefined;
    } = {
      platform: 'win32',
      architecture: 'x64',
      nodeApiVersion: '8',
    };
    const mutableOptions = {
      ...createLoaderOptions(fixture.manifestPath, artifactPath => {
        loadedPaths.push(artifactPath);
        return createNativeModule();
      }),
      trust: mutableTrust,
      runtimeFacts: mutableFacts,
    };
    const loader = createWindowsOwnedPipeNativeBindingLoader(mutableOptions);

    mutableOptions.manifestPath = path.join(root, 'changed', 'manifest.json');
    mutableOptions.expectedRuntimeVersion = 'changed';
    mutableOptions.expectedApplicationVersion = 'changed';
    mutableTrust.expectedPublisherIdentity = 'changed';
    mutableFacts.architecture = 'arm64';
    mutableFacts.nodeApiVersion = '1';

    const firstLoad = loader.load();
    const secondLoad = loader.load();
    expect(secondLoad).toBe(firstLoad);
    const binding = await firstLoad;
    expect(loadedPaths).toEqual([await fsp.realpath(fixture.artifactPath)]);

    const nativeProcess = binding.createWindowsOwnedPipeProcess({
      executablePath: 'C:\\Windows\\System32\\cmd.exe',
      argv: ['/d', '/s', '/c', 'echo ok'],
      cwd: 'C:\\conversation',
      environment: [],
    });
    await expect(nativeProcess.terminateAndWaitTreeEmpty()).resolves.toBeUndefined();
    await expect(nativeProcess.release()).resolves.toBeUndefined();

    await fsp.writeFile(fixture.artifactPath, Buffer.from('changed-after-load'));
    await expect(loader.load()).resolves.toBe(binding);
    expect(loadedPaths).toHaveLength(1);
  });

  it('同一 Utility generation 保持首次校验失败，新 generation 才重新验证修复后的制品', async () => {
    const fixture = await writeFixture();
    await fsp.writeFile(fixture.artifactPath, Buffer.from('native-addon-fixturx'));
    let nativeLoadCalls = 0;
    const options = createLoaderOptions(fixture.manifestPath, () => {
      nativeLoadCalls += 1;
      return createNativeModule();
    });
    const failedGeneration = createWindowsOwnedPipeNativeBindingLoader(options);

    const firstFailure = failedGeneration.load();
    const repeatedFailure = failedGeneration.load();
    expect(repeatedFailure).toBe(firstFailure);
    await expectLoadError(() => firstFailure, 'artifact_hash_mismatch');

    await fsp.writeFile(fixture.artifactPath, ARTIFACT_BYTES);
    await expectLoadError(
      () => failedGeneration.load(),
      'artifact_hash_mismatch',
    );
    expect(nativeLoadCalls).toBe(0);

    const nextGeneration = createWindowsOwnedPipeNativeBindingLoader(options);
    await expect(nextGeneration.load()).resolves.toBeDefined();
    expect(nativeLoadCalls).toBe(1);
  });

  it('PTY loader 复用同一 manifest 验证，并保留异步 input 接纳合同', async () => {
    const fixture = await writeFixture();
    let nativeInput: Buffer | undefined;
    const loader = createWindowsOwnedPtyNativeBindingLoader(
      createLoaderOptions(fixture.manifestPath, () => createNativeModule({
        onPtyWrite(data) { nativeInput = data; },
      })),
    );
    const binding = await loader.load();
    const nativeProcess = binding.createWindowsOwnedPtyProcess({
      executablePath: 'C:\\Windows\\System32\\cmd.exe',
      argv: [],
      cwd: 'C:\\conversation',
      environment: [],
    }, 80, 24);

    await expect(nativeProcess.writeInput(Uint8Array.of(1, 2, 3))).resolves.toBe(3);
    expect(Buffer.isBuffer(nativeInput)).toBe(true);
    expect(nativeInput).toEqual(Buffer.from([1, 2, 3]));
    nativeProcess.resize(100, 30);
    await expect(nativeProcess.terminateAndWaitTreeEmpty()).resolves.toBeUndefined();
    await expect(nativeProcess.release()).resolves.toBeUndefined();
  });

  it('PTY binding 拒绝把 native 部分接纳冒充完整 input 接纳', async () => {
    const fixture = await writeFixture();
    const loader = createWindowsOwnedPtyNativeBindingLoader(
      createLoaderOptions(fixture.manifestPath, () => createNativeModule({ acceptedPtyBytes: 2 })),
    );
    const binding = await loader.load();
    const nativeProcess = binding.createWindowsOwnedPtyProcess({
      executablePath: 'C:\\Windows\\System32\\cmd.exe',
      argv: [],
      cwd: 'C:\\conversation',
      environment: [],
    }, 80, 24);

    await expect(nativeProcess.writeInput(Uint8Array.of(1, 2, 3))).rejects.toMatchObject({
      code: 'binding_contract_invalid',
    });
  });

  it('在读取磁盘前拒绝相对路径和 app.asar 内路径', async () => {
    let nativeLoadCalls = 0;
    const loadNativeModule = () => {
      nativeLoadCalls += 1;
      return createNativeModule();
    };
    const relativeLoader = createWindowsOwnedPipeNativeBindingLoader(
      createLoaderOptions('relative/manifest.json', loadNativeModule),
    );
    const asarLoader = createWindowsOwnedPipeNativeBindingLoader(
      createLoaderOptions(
        path.join(root, 'app.asar', WINDOWS_OWNED_PIPE_NATIVE_MANIFEST_FILE_NAME),
        loadNativeModule,
      ),
    );

    await expectLoadError(() => relativeLoader.load(), 'manifest_invalid');
    await expectLoadError(() => asarLoader.load(), 'artifact_not_unpacked');
    expect(nativeLoadCalls).toBe(0);
  });

  it('拒绝损坏 JSON、未知字段和未知 schema，不进入 native loader', async () => {
    const malformed = await writeFixture();
    await fsp.writeFile(malformed.manifestPath, '{not-json');
    const extraField = await writeFixture({
      ...createManifest(),
      unexpected: true,
    });
    const unknownSchema = await writeFixture({
      ...createManifest(),
      schema_version: 2,
    });
    let nativeLoadCalls = 0;
    const loadNativeModule = () => {
      nativeLoadCalls += 1;
      return createNativeModule();
    };

    for (const fixture of [malformed, extraField, unknownSchema]) {
      const loader = createWindowsOwnedPipeNativeBindingLoader(
        createLoaderOptions(fixture.manifestPath, loadNativeModule),
      );
      await expectLoadError(() => loader.load(), 'manifest_invalid');
    }
    expect(nativeLoadCalls).toBe(0);
  });

  it('旧 runtime、旧 App、错误架构和不足的 Node-API 均 fail closed', async () => {
    const fixture = await writeFixture();
    let nativeLoadCalls = 0;
    const loadNativeModule = () => {
      nativeLoadCalls += 1;
      return createNativeModule();
    };
    const mismatches: WindowsOwnedPipeNativeBindingLoaderOptions[] = [
      {
        ...createLoaderOptions(fixture.manifestPath, loadNativeModule),
        expectedRuntimeVersion: '0.0.9',
      },
      {
        ...createLoaderOptions(fixture.manifestPath, loadNativeModule),
        expectedApplicationVersion: '0.0.37',
      },
      {
        ...createLoaderOptions(fixture.manifestPath, loadNativeModule),
        runtimeFacts: {
          platform: 'win32', architecture: 'arm64', nodeApiVersion: '8',
        },
      },
      {
        ...createLoaderOptions(fixture.manifestPath, loadNativeModule),
        runtimeFacts: {
          platform: 'win32', architecture: 'x64', nodeApiVersion: '7',
        },
      },
    ];

    for (const options of mismatches) {
      const loader = createWindowsOwnedPipeNativeBindingLoader(options);
      await expectLoadError(() => loader.load(), 'runtime_mismatch');
    }
    expect(nativeLoadCalls).toBe(0);
  });

  it('正式模式只接受发布管线记录的预期 Authenticode 发布者', async () => {
    const unsignedFixture = await writeFixture();
    const wrongPublisherFixture = await writeFixture({
      ...createManifest(),
      signature_evidence: {
        kind: 'authenticode_build_verified',
        publisher_identity: 'CN=Unexpected Publisher',
      },
    });
    const verifiedFixture = await writeFixture({
      ...createManifest(),
      signature_evidence: {
        kind: 'authenticode_build_verified',
        publisher_identity: PUBLISHER_IDENTITY,
      },
    });
    const loadedPaths: string[] = [];
    const loadNativeModule = (artifactPath: string) => {
      loadedPaths.push(artifactPath);
      return createNativeModule();
    };
    const releaseOptions = (manifestPath: string): WindowsOwnedPipeNativeBindingLoaderOptions => ({
      ...createLoaderOptions(manifestPath, loadNativeModule),
      trust: {
        kind: 'release',
        expectedPublisherIdentity: PUBLISHER_IDENTITY,
      },
    });

    for (const fixture of [unsignedFixture, wrongPublisherFixture]) {
      const loader = createWindowsOwnedPipeNativeBindingLoader(
        releaseOptions(fixture.manifestPath),
      );
      await expectLoadError(() => loader.load(), 'runtime_signature_unverified');
    }
    expect(loadedPaths).toEqual([]);

    const verifiedLoader = createWindowsOwnedPipeNativeBindingLoader(
      releaseOptions(verifiedFixture.manifestPath),
    );
    await expect(verifiedLoader.load()).resolves.toBeDefined();
    expect(loadedPaths).toHaveLength(1);
  });

  it('缺失、非普通文件、大小、hash 和相邻目录身份任一异常都不加载 native', async () => {
    const missing = await writeFixture();
    await fsp.rm(missing.artifactPath);

    const directoryArtifact = await writeFixture();
    await fsp.rm(directoryArtifact.artifactPath);
    await fsp.mkdir(directoryArtifact.artifactPath);

    const wrongSize = await writeFixture({
      ...createManifest(),
      artifact: {
        file_name: WINDOWS_OWNED_PIPE_NATIVE_ARTIFACT_FILE_NAME,
        size_bytes: ARTIFACT_BYTES.byteLength + 1,
        sha256: createHash('sha256').update(ARTIFACT_BYTES).digest('hex'),
      },
    });
    const wrongHash = await writeFixture({
      ...createManifest(),
      artifact: {
        file_name: WINDOWS_OWNED_PIPE_NATIVE_ARTIFACT_FILE_NAME,
        size_bytes: ARTIFACT_BYTES.byteLength,
        sha256: '0'.repeat(64),
      },
    });

    const escaped = await writeFixture();
    const outsideArtifact = path.join(root, 'outside.node');
    await fsp.writeFile(outsideArtifact, ARTIFACT_BYTES);
    await fsp.rm(escaped.artifactPath);
    await fsp.symlink(outsideArtifact, escaped.artifactPath);

    let nativeLoadCalls = 0;
    const loadNativeModule = () => {
      nativeLoadCalls += 1;
      return createNativeModule();
    };
    const cases: readonly [FixturePaths, WindowsNativeRuntimeLoadError['code']][] = [
      [missing, 'artifact_unavailable'],
      [directoryArtifact, 'artifact_unavailable'],
      [wrongSize, 'artifact_size_mismatch'],
      [wrongHash, 'artifact_hash_mismatch'],
      [escaped, 'artifact_not_unpacked'],
    ];
    for (const [fixture, code] of cases) {
      const loader = createWindowsOwnedPipeNativeBindingLoader(
        createLoaderOptions(fixture.manifestPath, loadNativeModule),
      );
      await expectLoadError(() => loader.load(), code);
    }
    expect(nativeLoadCalls).toBe(0);
  });

  it('当前制品缺失时不从 cwd、PATH 或旧安装目录搜索同名副本', async () => {
    const current = await writeFixture();
    await fsp.rm(current.artifactPath);
    const cwdFallback = path.join(root, 'cwd-fallback');
    const pathFallback = path.join(root, 'path-fallback');
    const oldInstallFallback = path.join(path.dirname(current.directory), 'old-install');
    for (const directory of [cwdFallback, pathFallback, oldInstallFallback]) {
      await fsp.mkdir(directory, { recursive: true });
      await fsp.writeFile(
        path.join(directory, WINDOWS_OWNED_PIPE_NATIVE_ARTIFACT_FILE_NAME),
        ARTIFACT_BYTES,
      );
    }

    let nativeLoadCalls = 0;
    const loader = createWindowsOwnedPipeNativeBindingLoader(
      createLoaderOptions(current.manifestPath, () => {
        nativeLoadCalls += 1;
        return createNativeModule();
      }),
    );
    const originalCwd = process.cwd();
    const originalPath = process.env.PATH;
    try {
      process.chdir(cwdFallback);
      process.env.PATH = pathFallback;
      await expectLoadError(() => loader.load(), 'artifact_unavailable');
    } finally {
      process.chdir(originalCwd);
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
    expect(nativeLoadCalls).toBe(0);
  });

  it('区分模块加载失败、顶层导出损坏和 native process 合同损坏', async () => {
    const fixture = await writeFixture();
    const moduleFailure = createWindowsOwnedPipeNativeBindingLoader(
      createLoaderOptions(fixture.manifestPath, () => {
        throw new Error('module ABI mismatch');
      }),
    );
    await expectLoadError(() => moduleFailure.load(), 'binding_load_failed');

    const missingFactory = createWindowsOwnedPipeNativeBindingLoader(
      createLoaderOptions(fixture.manifestPath, () => ({})),
    );
    await expectLoadError(() => missingFactory.load(), 'binding_contract_invalid');

    const invalidProcess = createWindowsOwnedPipeNativeBindingLoader(
      createLoaderOptions(fixture.manifestPath, () => ({
        createWindowsOwnedPipeProcess() {
          return { startObservers() {} };
        },
      })),
    );
    const binding = await invalidProcess.load();
    expect(() => binding.createWindowsOwnedPipeProcess({
      executablePath: 'cmd.exe', argv: [], cwd: 'C:\\', environment: [],
    })).toThrow(WindowsNativeRuntimeLoadError);

    const invalidPromise = createWindowsOwnedPipeNativeBindingLoader(
      createLoaderOptions(fixture.manifestPath, () => ({
        createWindowsOwnedPipeProcess() {
          return {
            startObservers() {},
            resumeAfterObserversReady() {},
            resumeOutput() {},
            cancelOutput() {},
            terminateAndWaitTreeEmpty() {},
            async release() {},
          };
        },
      })),
    );
    const invalidPromiseBinding = await invalidPromise.load();
    const nativeProcess = invalidPromiseBinding.createWindowsOwnedPipeProcess({
      executablePath: 'cmd.exe', argv: [], cwd: 'C:\\', environment: [],
    });
    await expect(nativeProcess.terminateAndWaitTreeEmpty()).rejects.toMatchObject({
      code: 'binding_contract_invalid',
    });
  });
});
