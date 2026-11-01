import { describe, expect, it, vi } from 'vitest';

import { resolveLocalProcessPlatformRuntime } from './resolveLocalProcessPlatformRuntime';

describe('resolveLocalProcessPlatformRuntime', () => {
  it('macOS 只产生通用 PGID owner 事实', async () => {
    expect(await resolveLocalProcessPlatformRuntime({
      platform: 'darwin',
      architecture: 'arm64',
      applicationVersion: '0.0.38',
      applicationExecutablePath: '/Applications/Linnya.app/Contents/MacOS/Linnya',
      resourcesPath: '/Applications/Linnya.app/Contents/Resources',
      packaged: true,
      hostEnvironment: {},
    })).toEqual({ schema_version: 1, platform: 'darwin' });
  });

  it('Windows 正式包按 App 签名状态选择信任，检查失败不降级', async () => {
    const base = {
      platform: 'win32' as const,
      architecture: 'x64' as const,
      applicationVersion: '0.0.38',
      applicationExecutablePath: 'C:\\Linnya\\Linnya.exe',
      resourcesPath: 'C:\\Linnya\\resources',
      hostEnvironment: { SystemRoot: 'C:\\Windows' },
    };
    const missingPublisher = { readAuthenticodeSignature: vi.fn(async () => undefined) };
    await expect(resolveLocalProcessPlatformRuntime({
      ...base,
      packaged: true,
      signatureProbe: missingPublisher,
    })).rejects.toThrow('requires a valid signature or explicit NotSigned status');

    const release = await resolveLocalProcessPlatformRuntime({
      ...base,
      packaged: true,
      signatureProbe: { readAuthenticodeSignature: vi.fn(async () => ({ status: 'Valid' as const, publisher: 'CN=Linnya' })) },
    });
    expect(release).toMatchObject({
      trust: { kind: 'release', expected_publisher_identity: 'CN=Linnya' },
    });
    expect(await resolveLocalProcessPlatformRuntime({
      ...base,
      packaged: true,
      signatureProbe: { readAuthenticodeSignature: vi.fn(async () => ({ status: 'NotSigned' as const, publisher: null })) },
    })).toMatchObject({ trust: { kind: 'release_unsigned' } });
    expect(await resolveLocalProcessPlatformRuntime({
      ...base,
      packaged: false,
    })).toMatchObject({ trust: { kind: 'development' } });

    const inspectionFailure = new Error('signature inspection timed out');
    await expect(resolveLocalProcessPlatformRuntime({
      ...base, packaged: true,
      signatureProbe: { readAuthenticodeSignature: vi.fn(async () => { throw inspectionFailure; }) },
    })).rejects.toBe(inspectionFailure);
  });

  it('Windows manifest 路径跟随 App 架构，并拒绝未发布的架构', async () => {
    const create = (architecture: NodeJS.Architecture) => (
      resolveLocalProcessPlatformRuntime({
        platform: 'win32',
        architecture,
        applicationVersion: '0.0.38',
        applicationExecutablePath: 'C:\\Linnya\\Linnya.exe',
        resourcesPath: 'C:\\Linnya\\resources',
        packaged: false,
        hostEnvironment: { SystemRoot: 'C:\\Windows' },
      })
    );

    expect(await create('x64')).toMatchObject({ manifest_path: expect.stringContaining('\\windows\\x64\\') });
    expect(await create('arm64')).toMatchObject({ manifest_path: expect.stringContaining('\\windows\\arm64\\') });
    await expect(create('ia32')).rejects.toThrow('does not support architecture ia32');
  });
});
