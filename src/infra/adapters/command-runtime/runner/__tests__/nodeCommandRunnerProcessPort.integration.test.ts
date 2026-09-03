import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandRunnerProcessHandlers } from '../../../../../domains/commands';
import { createNodeCommandRunnerProcessPort } from '../createNodeCommandRunnerProcessPort';

const childProcess = vi.hoisted(() => ({ fork: vi.fn() }));

vi.mock('node:child_process', () => ({ fork: childProcess.fork }));

class FakeNodeChild extends EventEmitter {
  readonly stderr = new PassThrough();
  connected = true;

  send(_message: unknown, callback: (error: Error | null) => void): void {
    callback(null);
  }

  disconnect(): void {
    this.connected = false;
  }

  kill(): boolean {
    return true;
  }
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

describe('Node command runner process factory', () => {
  beforeEach(() => {
    childProcess.fork.mockReset();
  });

  it('冻结 runtime 与 helper 环境，且不继承宿主 execArgv', () => {
    childProcess.fork.mockReturnValue(new FakeNodeChild());
    const helperEnvironment = { PATH: '/trusted/helper/path' };
    const platformRuntime = {
      schema_version: 1 as const,
      platform: 'win32' as const,
      manifest_path: 'C:\\runtime\\command-runtime.manifest.json',
      expected_runtime_version: '0.1.0',
      expected_application_version: '0.0.38',
      trust: { kind: 'development' as const },
    };
    const port = createNodeCommandRunnerProcessPort({
      runnerPath: '/runtime/commandRunnerProcess.cjs',
      nodeExecutablePath: '/runtime/node',
      helperEnvironment,
      platformRuntime,
    });

    helperEnvironment.PATH = '/mutated/path';
    platformRuntime.manifest_path = 'C:\\mutated\\manifest.json';
    port.fork(createHandlers());

    expect(childProcess.fork).toHaveBeenCalledTimes(1);
    const [runnerPath, argv, options] = childProcess.fork.mock.calls[0] ?? [];
    expect(runnerPath).toBe('/runtime/commandRunnerProcess.cjs');
    expect(argv).toHaveLength(1);
    expect(JSON.parse(String(argv?.[0]))).toEqual({
      schema_version: 1,
      platform: 'win32',
      manifest_path: 'C:\\runtime\\command-runtime.manifest.json',
      expected_runtime_version: '0.1.0',
      expected_application_version: '0.0.38',
      trust: { kind: 'development' },
    });
    expect(options).toMatchObject({
      execPath: '/runtime/node',
      execArgv: [],
      env: { PATH: '/trusted/helper/path' },
      serialization: 'advanced',
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
  });

  it('在 fork 前拒绝相对 helper 路径和 Windows manifest', () => {
    expect(() => createNodeCommandRunnerProcessPort({
      runnerPath: 'relative-runner.cjs',
      nodeExecutablePath: '/runtime/node',
      helperEnvironment: {},
      platformRuntime: { schema_version: 1, platform: 'darwin' },
    })).toThrow('must be absolute');
    expect(() => createNodeCommandRunnerProcessPort({
      runnerPath: '/runtime/runner.cjs',
      nodeExecutablePath: 'relative-node',
      helperEnvironment: {},
      platformRuntime: { schema_version: 1, platform: 'darwin' },
    })).toThrow('must be absolute');
    expect(() => createNodeCommandRunnerProcessPort({
      runnerPath: '/runtime/runner.cjs',
      nodeExecutablePath: '/runtime/node',
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
    expect(childProcess.fork).not.toHaveBeenCalled();
  });
});
