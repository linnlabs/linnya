import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createNodeSandboxUtilityProcessFork } from './createNodeSandboxUtilityProcessFork';

const childProcess = vi.hoisted(() => ({ fork: vi.fn() }));

vi.mock('node:child_process', () => ({ fork: childProcess.fork }));

class FakeNodeChild extends EventEmitter {
  readonly stderr = new PassThrough();
  connected = true;
  readonly sent: unknown[] = [];
  readonly kill = vi.fn(() => true);

  send(message: unknown, callback: (error: Error | null) => void): boolean {
    this.sent.push(message);
    callback(null);
    return true;
  }
}

describe('Node Sandbox Utility process fork', () => {
  beforeEach(() => {
    childProcess.fork.mockReset();
  });

  it('用固定 headless Node 和干净参数创建无窗口一次性 child', () => {
    const child = new FakeNodeChild();
    childProcess.fork.mockReturnValue(child);
    const port = createNodeSandboxUtilityProcessFork({
      nodeExecutablePath: '/runtime/bin/node',
    });

    const process = port.fork({
      utilityPath: '/runtime/sandboxUtilityProcess.cjs',
      argv: ['generation', 'platform-runtime'],
      environment: { PATH: '/usr/bin:/bin' },
    });
    process.postMessage({ kind: 'test' });
    process.kill();

    expect(childProcess.fork).toHaveBeenCalledWith(
      '/runtime/sandboxUtilityProcess.cjs',
      ['generation', 'platform-runtime'],
      {
        execPath: '/runtime/bin/node',
        execArgv: [],
        env: { PATH: '/usr/bin:/bin' },
        serialization: 'advanced',
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      },
    );
    expect(child.sent).toEqual([{ kind: 'test' }]);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('拒绝相对 Node 或 Utility 路径', () => {
    expect(() => createNodeSandboxUtilityProcessFork({
      nodeExecutablePath: 'node',
    })).toThrow('must be absolute');

    const port = createNodeSandboxUtilityProcessFork({
      nodeExecutablePath: '/runtime/bin/node',
    });
    expect(() => port.fork({
      utilityPath: 'sandboxUtilityProcess.cjs',
      argv: [],
      environment: {},
    })).toThrow('must be absolute');
    expect(childProcess.fork).not.toHaveBeenCalled();
  });
});
