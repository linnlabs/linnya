import { describe, expect, it, vi } from 'vitest';

import { resolveElectronLocalProcessPlatformRuntime } from './resolveElectronLocalProcessPlatformRuntime';

describe('resolveElectronLocalProcessPlatformRuntime', () => {
  it('macOS 只产生通用 PGID owner 事实', () => {
    expect(resolveElectronLocalProcessPlatformRuntime({
      platform: 'darwin',
      architecture: 'arm64',
      applicationVersion: '0.0.38',
      applicationExecutablePath: '/Applications/Linnya.app/Contents/MacOS/Linnya',
      resourcesPath: '/Applications/Linnya.app/Contents/Resources',
      packaged: true,
      hostEnvironment: {},
    })).toEqual({ schema_version: 1, platform: 'darwin' });
  });

  it('Windows 正式包只接受 App 签名发布者，开发包不冒充正式信任', () => {
    const base = {
      platform: 'win32' as const,
      architecture: 'x64' as const,
      applicationVersion: '0.0.38',
      applicationExecutablePath: 'C:\\Linnya\\Linnya.exe',
      resourcesPath: 'C:\\Linnya\\resources',
      hostEnvironment: { SystemRoot: 'C:\\Windows' },
    };
    const missingPublisher = { readAuthenticodePublisher: vi.fn(() => undefined) };
    expect(() => resolveElectronLocalProcessPlatformRuntime({
      ...base,
      packaged: true,
      publisherProbe: missingPublisher,
    })).toThrow('requires a valid signed application publisher');

    const release = resolveElectronLocalProcessPlatformRuntime({
      ...base,
      packaged: true,
      publisherProbe: { readAuthenticodePublisher: vi.fn(() => 'CN=Linnya') },
    });
    expect(release).toMatchObject({
      trust: { kind: 'release', expected_publisher_identity: 'CN=Linnya' },
    });
    expect(resolveElectronLocalProcessPlatformRuntime({
      ...base,
      packaged: false,
    })).toMatchObject({ trust: { kind: 'development' } });
  });

  it('Windows manifest 路径跟随 App 架构，并拒绝未发布的架构', () => {
    const create = (architecture: NodeJS.Architecture) => (
      resolveElectronLocalProcessPlatformRuntime({
        platform: 'win32',
        architecture,
        applicationVersion: '0.0.38',
        applicationExecutablePath: 'C:\\Linnya\\Linnya.exe',
        resourcesPath: 'C:\\Linnya\\resources',
        packaged: false,
        hostEnvironment: { SystemRoot: 'C:\\Windows' },
      })
    );

    expect(create('x64')).toMatchObject({ manifest_path: expect.stringContaining('\\windows\\x64\\') });
    expect(create('arm64')).toMatchObject({ manifest_path: expect.stringContaining('\\windows\\arm64\\') });
    expect(() => create('ia32')).toThrow('does not support architecture ia32');
  });
});
