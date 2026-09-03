import { spawn, type ChildProcess } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createNodeProcessTreeStopRequest,
} from '../infrastructure/requestNodeProcessTreeStopAndWaitForClose';

function waitForClose(child: ChildProcess): Promise<void> {
  return new Promise(resolve => child.once('close', () => resolve()));
}

async function stopDirectChild(child: ChildProcess): Promise<void> {
  const close = waitForClose(child);
  child.kill('SIGKILL');
  await close;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForPid(filePath: string): Promise<number> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      const pid = Number((await fsp.readFile(filePath, 'utf8')).trim());
      if (Number.isSafeInteger(pid) && pid > 0) return pid;
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('脱组 helper 未发布 PID');
}

describe('requestNodeProcessTreeStopAndWaitForClose', () => {
  const cleanupChildren = new Set<ChildProcess>();
  const cleanupPids = new Set<number>();

  afterEach(async () => {
    for (const pid of cleanupPids) {
      if (isProcessAlive(pid)) process.kill(pid, 'SIGKILL');
    }
    for (const child of cleanupChildren) {
      if (child.exitCode === null && child.signalCode === null) {
        await stopDirectChild(child);
      }
    }
    cleanupChildren.clear();
    cleanupPids.clear();
  });

  it('Windows 使用 SystemRoot 绝对路径并结构化保留 taskkill 非零退出码', async () => {
    const target = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    cleanupChildren.add(target);
    let observedExecutable = '';
    let observedArgv: readonly string[] = [];
    let observedEnvironment: Readonly<Record<string, string>> = {};
    const stop = createNodeProcessTreeStopRequest({
      platform: 'win32',
      environment: {
        SYSTEMROOT: 'C:\\Windows',
        LINNYA_INTERNAL_SECRET: 'must-not-reach-taskkill',
      },
      spawnTerminator(executablePath, argv, environment) {
        observedExecutable = executablePath;
        observedArgv = argv;
        observedEnvironment = environment;
        return spawn(process.execPath, ['-e', 'process.exit(7)'], { stdio: 'ignore' });
      },
    });

    await expect(stop(target)).rejects.toMatchObject({
      code: 'windows_terminator_failed',
      platformExitCode: 7,
    });
    expect(observedExecutable).toBe('C:\\Windows\\System32\\taskkill.exe');
    expect(observedArgv).toEqual(['/pid', String(target.pid), '/T', '/F']);
    expect(observedEnvironment).toEqual({ SYSTEMROOT: 'C:\\Windows' });
  });

  it('Windows terminator 无法启动时返回稳定停止错误', async () => {
    const target = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    cleanupChildren.add(target);
    const stop = createNodeProcessTreeStopRequest({
      platform: 'win32',
      environment: { SystemRoot: 'C:\\Windows' },
      spawnTerminator() {
        return spawn(path.join(os.tmpdir(), 'missing-windows-terminator.exe'), [], {
          stdio: 'ignore',
        });
      },
    });

    await expect(stop(target)).rejects.toMatchObject({
      code: 'windows_terminator_launch_failed',
      cause: expect.any(Error),
    });
  });

  it('Windows terminator 返回零后仍等待根 close', async () => {
    const target = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    cleanupChildren.add(target);
    let announceTerminator: (() => void) | undefined;
    const terminatorStarted = new Promise<void>(resolve => {
      announceTerminator = resolve;
    });
    const stop = createNodeProcessTreeStopRequest({
      platform: 'win32',
      environment: { SystemRoot: 'C:\\Windows' },
      phaseTimeoutMs: 500,
      spawnTerminator() {
        announceTerminator?.();
        return spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
      },
    });

    const stopping = stop(target);
    await terminatorStarted;
    const earlyOutcome = await Promise.race([
      stopping.then(() => 'resolved' as const, () => 'rejected' as const),
      new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), 30)),
    ]);
    expect(earlyOutcome).toBe('pending');
    await stopDirectChild(target);
    await expect(stopping).resolves.toBeUndefined();
  });

  it('Windows terminator 自身卡住时有界失败', async () => {
    const target = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    cleanupChildren.add(target);
    let terminator: ChildProcess | undefined;
    let terminatorClose: Promise<void> | undefined;
    const stop = createNodeProcessTreeStopRequest({
      platform: 'win32',
      environment: { SystemRoot: 'C:\\Windows' },
      phaseTimeoutMs: 50,
      spawnTerminator() {
        terminator = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
          stdio: 'ignore',
        });
        cleanupChildren.add(terminator);
        terminatorClose = waitForClose(terminator);
        return terminator;
      },
    });

    await expect(stop(target)).rejects.toMatchObject({
      code: 'windows_terminator_timed_out',
    });
    if (!terminator || !terminatorClose) throw new Error('测试终止器未启动');
    await terminatorClose;
    cleanupChildren.delete(terminator);
  });

  it.runIf(process.platform !== 'win32')(
    '脱组 helper 继承 pipe 时有界失败，不把 root exit 冒充完整收口',
    async () => {
      const testRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-detached-helper-'));
      const helperPidPath = path.join(testRoot, 'helper.pid');
      const target = spawn(process.execPath, [
        '-e',
        [
          "const { spawn } = require('node:child_process')",
          "const { writeFileSync } = require('node:fs')",
          "const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: ['ignore', process.stdout, process.stderr] })",
          'writeFileSync(process.argv[1], String(helper.pid))',
          'setInterval(() => {}, 1000)',
        ].join(';'),
        helperPidPath,
      ], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      cleanupChildren.add(target);
      target.stdout?.resume();
      target.stderr?.resume();
      const helperPid = await waitForPid(helperPidPath);
      cleanupPids.add(helperPid);
      const stop = createNodeProcessTreeStopRequest({ phaseTimeoutMs: 100 });

      await expect(stop(target)).rejects.toMatchObject({
        code: 'child_close_timed_out',
      });
      expect(target.signalCode).toBe('SIGKILL');
      expect(isProcessAlive(helperPid)).toBe(true);

      const targetClose = waitForClose(target);
      process.kill(helperPid, 'SIGKILL');
      cleanupPids.delete(helperPid);
      await targetClose;
      cleanupChildren.delete(target);
      await fsp.rm(testRoot, { recursive: true, force: true });
    },
  );
});
