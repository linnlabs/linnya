import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RegisteredCommandDescriptor } from '../../../definitions/commandExecution';
import type { CommandDescriptorRegistryPort } from '../../../ports/commandDescriptorRegistryPort';
import { createNodeCommandProcess } from '../infrastructure/createNodeCommandProcess';
import { executeRegisteredCommand } from '../orchestration/executeRegisteredCommand';

describe('executeRegisteredCommand', () => {
  let testRoot: string;
  let allowedRoot: string;
  let outsideRoot: string;
  const spawnedPids = new Set<number>();

  beforeEach(async () => {
    testRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-command-domain-'));
    allowedRoot = path.join(testRoot, 'allowed');
    outsideRoot = path.join(testRoot, 'outside');
    await Promise.all([
      fsp.mkdir(allowedRoot),
      fsp.mkdir(outsideRoot),
    ]);
  });

  afterEach(async () => {
    for (const pid of spawnedPids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // 测试目标已经退出时无需额外处理。
      }
    }
    spawnedPids.clear();
    await fsp.rm(testRoot, { recursive: true, force: true });
  });

  async function waitForProcessIds(filePath: string): Promise<readonly number[]> {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      try {
        const values = (await fsp.readFile(filePath, 'utf8'))
          .trim()
          .split(',')
          .map(value => Number(value));
        if (values.length === 2 && values.every(Number.isSafeInteger)) {
          values.forEach(pid => spawnedPids.add(pid));
          return values;
        }
      } catch {
        // 父进程尚未发布 PID，继续等待真实启动完成。
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Command process tree did not start in time');
  }

  async function expectProcessExited(pid: number): Promise<void> {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
      } catch {
        spawnedPids.delete(pid);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Command descendant ${pid} remained alive`);
  }

  function processTreeArgv(pidFile: string): readonly string[] {
    return [
      '-e',
      [
        "const { spawn } = require('node:child_process')",
        "const { writeFileSync } = require('node:fs')",
        "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
        "writeFileSync(process.argv[1], `${process.pid},${child.pid}`)",
        'setInterval(() => {}, 1000)',
      ].join(';'),
      pidFile,
    ];
  }

  function createDirectChildStopProcess() {
    return createNodeCommandProcess({
      requestProcessTreeStopAndWaitForClose: child => new Promise<void>(resolve => {
        child.once('close', () => resolve());
        child.kill('SIGKILL');
      }),
    });
  }

  function createDescriptor(
    overrides: Partial<RegisteredCommandDescriptor> = {},
  ): RegisteredCommandDescriptor {
    return {
      id: 'test.node',
      executablePath: process.execPath,
      argvPrefix: [],
      allowedCwdRoots: [allowedRoot],
      inheritedEnvironmentKeys: [],
      allowedEnvironmentOverrides: ['VISIBLE_VALUE'],
      defaultTimeoutMs: 1_000,
      maxTimeoutMs: 2_000,
      maxStdoutBytes: 1_024,
      maxStderrBytes: 1_024,
      ...overrides,
    };
  }

  function createRegistry(
    descriptor: RegisteredCommandDescriptor = createDescriptor(),
  ): CommandDescriptorRegistryPort {
    return {
      get(commandId) {
        return commandId === descriptor.id ? descriptor : undefined;
      },
    };
  }

  it('以 argv 执行命令，shell 元字符只作为普通参数', async () => {
    const markerPath = path.join(allowedRoot, 'must-not-exist');
    const suspiciousArgument = `; touch ${markerPath}`;
    const result = await executeRegisteredCommand({
      request: {
        commandId: 'test.node',
        cwd: allowedRoot,
        argv: [
          '-e',
          'process.stdout.write(process.argv[1])',
          suspiciousArgument,
        ],
      },
      registry: createRegistry(),
      process: createNodeCommandProcess(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(suspiciousArgument);
    await expect(fsp.stat(markerPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('始终在调用方参数前保留宿主登记的 argv 前缀', async () => {
    const result = await executeRegisteredCommand({
      request: {
        commandId: 'test.node',
        cwd: allowedRoot,
        argv: ['caller-value'],
      },
      registry: createRegistry(createDescriptor({
        argvPrefix: [
          '-e',
          'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
          'host-value',
        ],
      })),
      process: createNodeCommandProcess(),
    });

    expect(JSON.parse(result.stdout)).toEqual(['host-value', 'caller-value']);
  });

  it('拒绝 cwd 通过符号链接逃出登记根', async () => {
    const escapedCwd = path.join(allowedRoot, 'escaped');
    await fsp.symlink(outsideRoot, escapedCwd);

    await expect(executeRegisteredCommand({
      request: {
        commandId: 'test.node',
        cwd: escapedCwd,
        argv: ['-e', 'process.exit(0)'],
      },
      registry: createRegistry(),
      process: createNodeCommandProcess(),
    })).rejects.toMatchObject({
      code: 'command.execution.cwd_out_of_scope',
    });
  });

  it('只允许 descriptor 白名单中的环境变量覆盖', async () => {
    await expect(executeRegisteredCommand({
      request: {
        commandId: 'test.node',
        cwd: allowedRoot,
        argv: ['-e', 'process.exit(0)'],
        environment: { SECRET_VALUE: 'not-allowed' },
      },
      registry: createRegistry(),
      process: createNodeCommandProcess(),
    })).rejects.toMatchObject({
      code: 'command.execution.environment_not_allowed',
    });

    const result = await executeRegisteredCommand({
      request: {
        commandId: 'test.node',
        cwd: allowedRoot,
        argv: ['-e', 'process.stdout.write(process.env.VISIBLE_VALUE ?? "missing")'],
        environment: { VISIBLE_VALUE: 'allowed' },
      },
      registry: createRegistry(),
      process: createNodeCommandProcess(),
    });
    expect(result.stdout).toBe('allowed');
  });

  it('已登记文件被操作系统拒绝启动时返回稳定错误并保留原因', async () => {
    const invalidExecutablePath = path.join(allowedRoot, 'invalid-executable');
    await fsp.writeFile(invalidExecutablePath, 'not an executable', { mode: 0o644 });
    await expect(executeRegisteredCommand({
      request: {
        commandId: 'test.node',
        cwd: allowedRoot,
        argv: [],
      },
      registry: createRegistry(createDescriptor({
        executablePath: invalidExecutablePath,
      })),
      process: createNodeCommandProcess(),
    })).rejects.toMatchObject({
      code: 'command.execution.launch_failed',
      cause: expect.any(Error),
    });
  });

  it('超时和取消使用不同稳定错误', async () => {
    await expect(executeRegisteredCommand({
      request: {
        commandId: 'test.node',
        cwd: allowedRoot,
        argv: ['-e', 'setInterval(() => {}, 1000)'],
        timeoutMs: 20,
      },
      registry: createRegistry(),
      process: createDirectChildStopProcess(),
    })).rejects.toMatchObject({
      code: 'command.execution.timed_out',
    });

    const controller = new AbortController();
    const execution = executeRegisteredCommand({
      request: {
        commandId: 'test.node',
        cwd: allowedRoot,
        argv: ['-e', 'setInterval(() => {}, 1000)'],
      },
      registry: createRegistry(),
      process: createDirectChildStopProcess(),
      abortSignal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);
    await expect(execution).rejects.toMatchObject({
      code: 'command.execution.cancelled',
    });
  });

  it('执行前已经取消时不启动命令', async () => {
    const controller = new AbortController();
    controller.abort();
    let spawnCount = 0;

    await expect(executeRegisteredCommand({
      request: {
        commandId: 'test.node',
        cwd: allowedRoot,
        argv: ['-e', 'process.exit(0)'],
      },
      registry: createRegistry(),
      process: createNodeCommandProcess({
        spawnChild() {
          spawnCount += 1;
          throw new Error('pre-aborted command must not reach spawn');
        },
      }),
      abortSignal: controller.signal,
    })).rejects.toMatchObject({
      code: 'command.execution.cancelled',
    });
    expect(spawnCount).toBe(0);
  });

  it('自然退出在 stdout 和 stderr 尾部排空后才返回完整结果', async () => {
    const result = await executeRegisteredCommand({
      request: {
        commandId: 'test.node',
        cwd: allowedRoot,
        argv: [
          '-e',
          [
            'process.stdout.write("stdout-head|")',
            'process.stderr.write("stderr-head|")',
            'setImmediate(() => {',
            '  process.stdout.write("stdout-tail")',
            '  process.stderr.write("stderr-tail")',
            '})',
          ].join(';'),
        ],
      },
      registry: createRegistry(),
      process: createNodeCommandProcess(),
    });

    expect(result.stdout).toBe('stdout-head|stdout-tail');
    expect(result.stderr).toBe('stderr-head|stderr-tail');
  });

  it('取消必须等待内部停止依赖完成后才能结算', async () => {
    const controller = new AbortController();
    const pidFile = path.join(allowedRoot, 'delayed-stop-pids.txt');
    let releaseStop: (() => void) | undefined;
    let announceStopStarted: (() => void) | undefined;
    const stopStarted = new Promise<void>(resolve => {
      announceStopStarted = resolve;
    });
    const execution = executeRegisteredCommand({
      request: {
        commandId: 'test.node',
        cwd: allowedRoot,
        argv: processTreeArgv(pidFile),
      },
      registry: createRegistry(),
      process: createNodeCommandProcess({
        requestProcessTreeStopAndWaitForClose: child => new Promise<void>(resolve => {
          releaseStop = () => {
            child.once('close', () => resolve());
            child.kill('SIGKILL');
          };
          announceStopStarted?.();
        }),
      }),
      abortSignal: controller.signal,
    });

    await waitForProcessIds(pidFile);
    controller.abort();
    await stopStarted;
    const earlyOutcome = await Promise.race([
      execution.then(() => 'resolved' as const, () => 'rejected' as const),
      new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), 30)),
    ]);
    expect(earlyOutcome).toBe('pending');
    if (!releaseStop) throw new Error('测试停止依赖未发布释放动作');
    releaseStop();
    await expect(execution).rejects.toMatchObject({
      code: 'command.execution.cancelled',
    });
  });

  it('进程树停止失败不会伪装成原取消已经完成', async () => {
    const controller = new AbortController();
    const pidFile = path.join(allowedRoot, 'failed-stop-pids.txt');
    const execution = executeRegisteredCommand({
      request: {
        commandId: 'test.node',
        cwd: allowedRoot,
        argv: processTreeArgv(pidFile),
      },
      registry: createRegistry(),
      process: createNodeCommandProcess({
        requestProcessTreeStopAndWaitForClose: child => new Promise<void>((_resolve, reject) => {
          child.once('close', () => reject(new Error('simulated platform stop failure')));
          child.kill('SIGKILL');
        }),
      }),
      abortSignal: controller.signal,
    });

    await waitForProcessIds(pidFile);
    controller.abort();
    await expect(execution).rejects.toMatchObject({
      code: 'command.execution.termination_failed',
      cause: {
        requestedFailure: { code: 'command.execution.cancelled' },
        stopFailure: expect.any(Error),
      },
    });
  });

  it.runIf(process.platform !== 'win32').each([
    { mode: 'timeout' as const, expectedCode: 'command.execution.timed_out' },
    { mode: 'cancel' as const, expectedCode: 'command.execution.cancelled' },
  ])('$mode 会终止 command 的父子进程树', async ({ mode, expectedCode }) => {
    const pidFile = path.join(allowedRoot, `${mode}-pids.txt`);
    const controller = new AbortController();
    const execution = executeRegisteredCommand({
      request: {
        commandId: 'test.node',
        cwd: allowedRoot,
        argv: processTreeArgv(pidFile),
        timeoutMs: mode === 'timeout' ? 500 : 2_000,
      },
      registry: createRegistry(),
      process: createNodeCommandProcess(),
      abortSignal: controller.signal,
    });
    const [parentPid, childPid] = await waitForProcessIds(pidFile);
    if (mode === 'cancel') {
      controller.abort();
    }

    await expect(execution).rejects.toMatchObject({ code: expectedCode });
    await Promise.all([
      expectProcessExited(parentPid),
      expectProcessExited(childPid),
    ]);
  });

  it('stdout 超限时终止进程且不返回截断后的伪成功', async () => {
    await expect(executeRegisteredCommand({
      request: {
        commandId: 'test.node',
        cwd: allowedRoot,
        argv: ['-e', 'process.stdout.write("x".repeat(128))'],
      },
      registry: createRegistry(createDescriptor({ maxStdoutBytes: 32 })),
      process: createDirectChildStopProcess(),
    })).rejects.toMatchObject({
      code: 'command.execution.output_limit_exceeded',
    });
  });
});
