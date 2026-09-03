import { PassThrough } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandRunnerProcessHandlers } from '../../../../domains/commands';
import { parseCommandRunnerUtilityGeneration } from '../../../../infra/adapters/command-runtime/runner/definitions/commandRunnerUtilityTransport';
import { createElectronCommandRunnerProcessPort } from '../createElectronCommandRunnerProcessPort';

const electron = vi.hoisted(() => ({
  appReady: true,
  fork: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { isReady: () => electron.appReady },
  utilityProcess: { fork: electron.fork },
}));

function createUtilityChild() {
  return {
    stderr: new PassThrough(),
    postMessage: vi.fn(),
    kill: vi.fn(() => true),
    on: vi.fn(),
    once: vi.fn(),
  };
}

function createHandlers(): CommandRunnerProcessHandlers {
  return {
    onMessage() {},
    onDiagnostic() {},
    onDisconnect() {},
    onError() {},
    onClose() {},
  };
}

describe('Electron command runner process factory', () => {
  beforeEach(() => {
    electron.appReady = true;
    electron.fork.mockReset();
  });

  it('在 factory 创建时冻结 helper 环境和平台参数，并使用干净 utility argv', () => {
    const child = createUtilityChild();
    electron.fork.mockReturnValue(child);
    const helperEnvironment = { PATH: '/trusted/helper/path' };
    const platformRuntime = {
      schema_version: 1 as const,
      platform: 'win32' as const,
      manifest_path: 'C:\\Linnya Runtime\\command-runtime.manifest.json',
      expected_runtime_version: '0.1.0',
      expected_application_version: '0.0.38',
      trust: { kind: 'development' as const },
    };
    const port = createElectronCommandRunnerProcessPort({
      runnerPath: '/Applications/Linnya.app/Contents/Resources/commandRunnerUtility.cjs',
      helperEnvironment,
      platformRuntime,
    });

    helperEnvironment.PATH = '/mutated/path';
    platformRuntime.manifest_path = 'C:\\mutated\\manifest.json';
    port.fork(createHandlers());

    expect(electron.fork).toHaveBeenCalledTimes(1);
    const [runnerPath, argv, options] = electron.fork.mock.calls[0] ?? [];
    expect(runnerPath).toBe('/Applications/Linnya.app/Contents/Resources/commandRunnerUtility.cjs');
    expect(Array.isArray(argv)).toBe(true);
    if (!Array.isArray(argv)) throw new Error('utility argv was not an array');
    expect(argv).toHaveLength(2);
    expect(() => parseCommandRunnerUtilityGeneration(argv[0])).not.toThrow();
    expect(JSON.parse(String(argv[1]))).toEqual({
      schema_version: 1,
      platform: 'win32',
      manifest_path: 'C:\\Linnya Runtime\\command-runtime.manifest.json',
      expected_runtime_version: '0.1.0',
      expected_application_version: '0.0.38',
      trust: { kind: 'development' },
    });
    expect(options).toMatchObject({
      env: { PATH: '/trusted/helper/path' },
      execArgv: [],
      serviceName: 'Linnya Command Runner',
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  });

  it('在 fork 前拒绝相对 runner 或 Windows manifest 路径', () => {
    expect(() => createElectronCommandRunnerProcessPort({
      runnerPath: 'relative-runner.cjs',
      helperEnvironment: {},
      platformRuntime: { schema_version: 1, platform: 'darwin' },
    })).toThrow('must be absolute');
    expect(() => createElectronCommandRunnerProcessPort({
      runnerPath: '/absolute/runner.cjs',
      helperEnvironment: {},
      platformRuntime: {
        schema_version: 1,
        platform: 'win32',
        manifest_path: 'relative-manifest.json',
        expected_runtime_version: '0.1.0',
        expected_application_version: '0.0.38',
        trust: { kind: 'development' },
      },
    })).toThrow('Windows local process runtime manifest path must be absolute');

    electron.appReady = false;
    const port = createElectronCommandRunnerProcessPort({
      runnerPath: '/absolute/runner.cjs',
      helperEnvironment: {},
      platformRuntime: { schema_version: 1, platform: 'darwin' },
    });
    expect(() => port.fork(createHandlers())).toThrow('requires Electron app ready');
    expect(electron.fork).not.toHaveBeenCalled();
  });
});
