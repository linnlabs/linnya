import { describe, expect, it } from 'vitest';

import {
  parseLocalProcessPlatformRuntime,
  parseSerializedLocalProcessPlatformRuntime,
  serializeLocalProcessPlatformRuntime,
} from '../index';

describe('Local process platform runtime transport', () => {
  it('严格往返 macOS 与 Windows release runtime', () => {
    expect(parseSerializedLocalProcessPlatformRuntime(
      serializeLocalProcessPlatformRuntime({ schema_version: 1, platform: 'darwin' }),
    )).toEqual({ schema_version: 1, platform: 'darwin' });

    const windows = {
      schema_version: 1 as const,
      platform: 'win32' as const,
      manifest_path: 'C:\\Linnya Runtime\\runtime.manifest.json',
      expected_runtime_version: '0.1.0',
      expected_application_version: '0.0.38',
      trust: {
        kind: 'release' as const,
        expected_publisher_identity: 'CN=Linnya',
      },
    };
    expect(parseSerializedLocalProcessPlatformRuntime(
      serializeLocalProcessPlatformRuntime(windows),
    )).toEqual(windows);
  });

  it('在进入 Utility 前拒绝相对 manifest、额外字段和损坏 JSON', () => {
    expect(() => parseLocalProcessPlatformRuntime({
      schema_version: 1,
      platform: 'win32',
      manifest_path: 'relative.manifest.json',
      expected_runtime_version: '0.1.0',
      expected_application_version: '0.0.38',
      trust: { kind: 'development' },
    })).toThrow('Windows local process runtime manifest path must be absolute');
    expect(() => parseLocalProcessPlatformRuntime({
      schema_version: 1,
      platform: 'darwin',
      command_only: true,
    })).toThrow();
    expect(() => parseSerializedLocalProcessPlatformRuntime('{not-json'))
      .toThrow('local process platform runtime argument is not valid JSON');
    expect(() => parseSerializedLocalProcessPlatformRuntime(undefined))
      .toThrow('local process platform runtime argument is required');
  });
});
