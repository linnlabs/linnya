import { execFile, spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import type { CommandPermissionLevel } from '@app/schemas/commands';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMacOsSandboxedOwnedPtyCommandProcess } from '../createMacOsSandboxedOwnedPtyCommandProcess';

const execFileAsync = promisify(execFile);
const fixturePath = path.resolve(
  globalThis.process.cwd(),
  'scripts/e2e/shell-tool/fixtures/process-trees/macos-process-group-tree.cjs',
);
const ownerHostFixturePath = path.resolve(
  globalThis.process.cwd(),
  'scripts/e2e/shell-tool/fixtures/macos-owned-pty-host.ts',
);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fsp.rm(root, { recursive: true, force: true })));
});

function readHostEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(globalThis.process.env).filter((entry): entry is [string, string] => (
      entry[1] !== undefined
    )),
  );
}

async function createRunRoot(): Promise<{ readonly cwd: string; readonly adjacent: string }> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-macos-pty-owner-test-'));
  roots.push(root);
  const cwd = path.join(root, '对话 目录');
  const adjacent = path.join(root, '相邻目录');
  await Promise.all([fsp.mkdir(cwd), fsp.mkdir(adjacent)]);
  return { cwd, adjacent };
}

function observeTranscript(stream: NodeJS.ReadableStream): {
  readonly complete: Promise<Buffer>;
  waitFor(pattern: RegExp): Promise<RegExpMatchArray>;
} {
  const chunks: Buffer[] = [];
  const waiters = new Set<() => void>();
  stream.on('data', (chunk: Buffer) => {
    chunks.push(Buffer.from(chunk));
    for (const notify of waiters) notify();
  });
  const complete = new Promise<Buffer>((resolve, reject) => {
    stream.once('end', () => resolve(Buffer.concat(chunks)));
    stream.once('error', reject);
  });
  return {
    complete,
    waitFor(pattern) {
      return new Promise<RegExpMatchArray>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(
            `PTY transcript did not match ${String(pattern)}: ${Buffer.concat(chunks).toString('utf8')}`,
          ));
        }, 3_000);
        const check = (): void => {
          const match = Buffer.concat(chunks).toString('utf8').match(pattern);
          if (!match) return;
          clearTimeout(timer);
          waiters.delete(check);
          resolve(match);
        };
        waiters.add(check);
        check();
      });
    },
  };
}

async function runNode(input: {
  readonly cwd: string;
  readonly conversationRoot: string;
  readonly permissionLevel: CommandPermissionLevel;
  readonly script: string;
  readonly argv?: readonly string[];
}): Promise<{ readonly exitCode: number | null; readonly transcript: string }> {
  const owned = await createMacOsSandboxedOwnedPtyCommandProcess({
    executablePath: globalThis.process.execPath,
    argv: ['-e', input.script, ...(input.argv ?? [])],
    cwd: input.cwd,
    conversationRoot: input.conversationRoot,
    environment: readHostEnvironment(),
    permissionLevel: input.permissionLevel,
    terminalSize: { columns: 80, rows: 24 },
  });
  const transcript = observeTranscript(owned.terminal).complete;
  const rootExit = await owned.rootExit;
  await expect(owned.treeEmpty).resolves.toEqual({ status: 'succeeded' });
  const bytes = await transcript;
  await expect(owned.release()).resolves.toEqual({ status: 'succeeded' });
  return { exitCode: rootExit.exitCode, transcript: bytes.toString('utf8') };
}

async function processIsAlive(pid: number): Promise<boolean> {
  try {
    globalThis.process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await fsp.access(filePath);
      return;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!await processIsAlive(pid)) return;
    await new Promise<void>(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Process ${pid} did not exit`);
}

describe.skipIf(globalThis.process.platform !== 'darwin')(
  'macOS sandboxed owned PTY command process',
  () => {
    it('按只读、标准、完全访问执行同一套真实文件写入边界', async () => {
      const { cwd, adjacent } = await createRunRoot();
      const script = `
        const fs = require('node:fs');
        const result = process.argv.slice(1).map(target => {
          try { fs.writeFileSync(target, 'written'); return 'written'; }
          catch { return 'denied'; }
        });
        process.stdout.write('__RESULT__' + result.join(',') + '__END__');
      `;
      const scenarios = [
        { level: 'read_only' as const, expected: 'denied,denied' },
        { level: 'standard' as const, expected: 'written,denied' },
        { level: 'full_access' as const, expected: 'written,written' },
      ];
      for (const scenario of scenarios) {
        const ownFile = path.join(cwd, `${scenario.level}-own.txt`);
        const adjacentFile = path.join(adjacent, `${scenario.level}-adjacent.txt`);
        const result = await runNode({
          cwd,
          conversationRoot: cwd,
          permissionLevel: scenario.level,
          script,
          argv: [ownFile, adjacentFile],
        });
        expect(result.exitCode).toBe(0);
        expect(result.transcript).toContain(`__RESULT__${scenario.expected}__END__`);
      }
    });

    it('只读和标准档允许真实 raw mode，但不扩大各自文件写入边界', async () => {
      const { cwd, adjacent } = await createRunRoot();
      const scenarios = [
        { level: 'read_only' as const, expected: 'denied,denied' },
        { level: 'standard' as const, expected: 'written,denied' },
      ];

      for (const scenario of scenarios) {
        const ownFile = path.join(cwd, `${scenario.level}-raw-own.txt`);
        const adjacentFile = path.join(adjacent, `${scenario.level}-raw-adjacent.txt`);
        const owned = await createMacOsSandboxedOwnedPtyCommandProcess({
          executablePath: globalThis.process.execPath,
          argv: ['-e', `
            const fs = require('node:fs');
            const results = process.argv.slice(1).map(target => {
              try { fs.writeFileSync(target, 'written'); return 'written'; }
              catch { return 'denied'; }
            });
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdout.write('__RAW_READY__' + process.stdin.isRaw + '__FILES__'
              + results.join(',') + '__');
            let input = '';
            process.stdin.on('data', chunk => {
              for (const byte of chunk) {
                if (byte === 4) {
                  process.stdout.write('__RAW_EOF__', () => process.exit(0));
                  return;
                }
                if (byte === 13) {
                  process.stdout.write('__RAW_SUBMIT__' + input + '__');
                  input = '';
                  continue;
                }
                input += Buffer.from([byte]).toString('utf8');
              }
            });
          `, ownFile, adjacentFile],
          cwd,
          conversationRoot: cwd,
          environment: readHostEnvironment(),
          permissionLevel: scenario.level,
          terminalSize: { columns: 80, rows: 24 },
        });
        const transcript = observeTranscript(owned.terminal);
        await transcript.waitFor(new RegExp(
          `__RAW_READY__true__FILES__${scenario.expected}__`,
          'u',
        ));
        await owned.interact({ type: 'submit', input: 'accepted-value' });
        await transcript.waitFor(/__RAW_SUBMIT__accepted-value__/u);
        await owned.interact({ type: 'eof' });
        await expect(owned.rootExit).resolves.toMatchObject({ exitCode: 0 });
        await expect(owned.treeEmpty).resolves.toEqual({ status: 'succeeded' });
        expect((await transcript.complete).toString('utf8')).toContain('__RAW_EOF__');
        await expect(owned.release()).resolves.toEqual({ status: 'succeeded' });
      }
    }, 15_000);

    it('真实接纳 write、submit、resize 和 eof，并冻结 spawn 时的 PGID', async () => {
      const { cwd } = await createRunRoot();
      const beforeResources = new Set(
        (await fsp.readdir(os.tmpdir())).filter(name => name.startsWith('linnya-command-pty-')),
      );
      const owned = await createMacOsSandboxedOwnedPtyCommandProcess({
        executablePath: globalThis.process.execPath,
        argv: ['-e', `
          process.stdin.setEncoding('utf8');
          process.stdout.write('__READY__' + process.pid + '__SIZE__'
            + process.stdout.columns + 'x' + process.stdout.rows + '__');
          process.on('SIGWINCH', () => process.stdout.write(
            '__RESIZED__' + process.stdout.columns + 'x' + process.stdout.rows + '__',
          ));
          process.stdin.on('data', value => process.stdout.write('__INPUT__' + JSON.stringify(value) + '__'));
          process.stdin.on('end', () => process.exit(23));
        `],
        cwd,
        conversationRoot: cwd,
        environment: readHostEnvironment(),
        permissionLevel: 'full_access',
        terminalSize: { columns: 80, rows: 24 },
      });
      expect(
        (await fsp.readdir(os.tmpdir()))
          .filter(name => name.startsWith('linnya-command-pty-'))
          .filter(name => !beforeResources.has(name)),
      ).toEqual([]);
      const transcript = observeTranscript(owned.terminal);
      const ready = await transcript.waitFor(/__READY__(\d+)__SIZE__80x24__/u);
      const rootPidText = ready[1];
      if (!rootPidText) throw new Error('PTY fixture did not publish its root PID');
      const rootPid = Number(rootPidText);
      const { stdout: pgidText } = await execFileAsync('/bin/ps', [
        '-o', 'pgid=', '-p', String(rootPid),
      ]);
      expect(Number(pgidText.trim())).toBe(rootPid);

      await owned.interact({ type: 'write', input: '中文 input' });
      await owned.interact({ type: 'submit', input: ' + submitted' });
      await transcript.waitFor(/__INPUT__"中文 input \+ submitted\\n"__/u);
      await owned.interact({ type: 'resize', columns: 100, rows: 30 });
      await transcript.waitFor(/__RESIZED__100x30__/u);
      await owned.interact({ type: 'eof' });

      await expect(owned.rootExit).resolves.toMatchObject({ exitCode: 23 });
      await expect(owned.treeEmpty).resolves.toEqual({ status: 'succeeded' });
      await expect(transcript.complete).resolves.toEqual(expect.any(Buffer));
      await expect(owned.release()).resolves.toEqual({ status: 'succeeded' });
    }, 15_000);

    it('根进程先退出时仍回收同进程组后代，并在多轮 release 后删除 FIFO 资源', async () => {
      const beforeResources = new Set(
        (await fsp.readdir(os.tmpdir())).filter(name => name.startsWith('linnya-command-pty-')),
      );
      for (let index = 0; index < 3; index += 1) {
        const { cwd } = await createRunRoot();
        const owned = await createMacOsSandboxedOwnedPtyCommandProcess({
          executablePath: globalThis.process.execPath,
          argv: [fixturePath, cwd, `pty-root-exit-${index}`, 'root-exit'],
          cwd,
          conversationRoot: cwd,
          environment: readHostEnvironment(),
          permissionLevel: 'full_access',
          terminalSize: { columns: 80, rows: 24 },
        });
        const transcript = observeTranscript(owned.terminal).complete;
        await expect(owned.rootExit).resolves.toMatchObject({ exitCode: 23 });
        await expect(owned.treeEmpty).resolves.toEqual({ status: 'succeeded' });
        await transcript;
        await expect(owned.release()).resolves.toEqual({ status: 'succeeded' });
        await expect(owned.release()).resolves.toEqual({ status: 'succeeded' });

        for (const role of ['parent', 'child', 'grandchild']) {
          const identityText = await fsp.readFile(path.join(cwd, `${role}.json`), 'utf8');
          const pidMatch = identityText.match(/"pid":(\d+)/u);
          const pidText = pidMatch?.[1];
          if (!pidText) throw new Error(`PTY fixture did not publish ${role} PID`);
          await expect(processIsAlive(Number(pidText))).resolves.toBe(false);
        }
      }
      const afterResources = (await fsp.readdir(os.tmpdir()))
        .filter(name => name.startsWith('linnya-command-pty-'))
        .filter(name => !beforeResources.has(name));
      expect(afterResources).toEqual([]);
    });

    it('Utility 被 SIGKILL 后由内核生命线回收整组进程且不遗留命名 FIFO', async () => {
      const { cwd } = await createRunRoot();
      const beforeResources = new Set(
        (await fsp.readdir(os.tmpdir())).filter(name => name.startsWith('linnya-command-pty-')),
      );
      const host = spawn(globalThis.process.execPath, [
        '--import',
        'tsx',
        ownerHostFixturePath,
        cwd,
        fixturePath,
      ], {
        cwd: globalThis.process.cwd(),
        env: readHostEnvironment(),
        stdio: 'ignore',
      });
      const hostClosed = new Promise<void>((resolve, reject) => {
        host.once('error', reject);
        host.once('close', () => resolve());
      });
      await waitForFile(path.join(cwd, 'owner-ready'));
      const pids = await Promise.all(['parent', 'child', 'grandchild'].map(async (role) => {
        const identityText = await fsp.readFile(path.join(cwd, `${role}.json`), 'utf8');
        const pidText = identityText.match(/"pid":(\d+)/u)?.[1];
        if (!pidText) throw new Error(`PTY owner-death fixture did not publish ${role} PID`);
        return Number(pidText);
      }));
      expect(host.kill('SIGKILL')).toBe(true);
      await hostClosed;
      await Promise.all(pids.map(waitForProcessExit));

      const leakedResources = (await fsp.readdir(os.tmpdir()))
        .filter(name => name.startsWith('linnya-command-pty-'))
        .filter(name => !beforeResources.has(name));
      expect(leakedResources).toEqual([]);
    }, 15_000);

    it('sandbox 后续启动失败会完整回滚，且下一条 PTY 仍能正常运行', async () => {
      const { cwd } = await createRunRoot();
      const beforeResources = new Set(
        (await fsp.readdir(os.tmpdir())).filter(name => name.startsWith('linnya-command-pty-')),
      );
      await expect(createMacOsSandboxedOwnedPtyCommandProcess({
        executablePath: globalThis.process.execPath,
        argv: ['-e', 'process.stdout.write("must-not-run")'],
        cwd: path.join(cwd, 'missing-working-directory'),
        conversationRoot: cwd,
        environment: readHostEnvironment(),
        permissionLevel: 'standard',
        terminalSize: { columns: 80, rows: 24 },
      })).rejects.toMatchObject({
        name: 'OwnedPtyCommandProcessStartupCleanupError',
        treeCleanup: { status: 'succeeded' },
        resourceRelease: { status: 'succeeded' },
      });
      const leakedResources = (await fsp.readdir(os.tmpdir()))
        .filter(name => name.startsWith('linnya-command-pty-'))
        .filter(name => !beforeResources.has(name));
      expect(leakedResources).toEqual([]);

      const recovered = await runNode({
        cwd,
        conversationRoot: cwd,
        permissionLevel: 'standard',
        script: 'process.stdout.write("__RECOVERED__")',
      });
      expect(recovered).toMatchObject({ exitCode: 0 });
      expect(recovered.transcript).toContain('__RECOVERED__');
    }, 15_000);

    it('启动后的 owner abort 复用同一条幂等整树停止链', async () => {
      const { cwd } = await createRunRoot();
      const controller = new AbortController();
      const owned = await createMacOsSandboxedOwnedPtyCommandProcess({
        executablePath: globalThis.process.execPath,
        argv: [fixturePath, cwd, 'abort-after-start', 'ignore-term'],
        cwd,
        conversationRoot: cwd,
        environment: readHostEnvironment(),
        permissionLevel: 'full_access',
        terminalSize: { columns: 80, rows: 24 },
      }, { abortSignal: controller.signal });
      const transcript = observeTranscript(owned.terminal).complete;
      await waitForFile(path.join(cwd, 'grandchild.json'));
      controller.abort();
      await expect(owned.treeEmpty).resolves.toEqual({ status: 'succeeded' });
      await transcript;
      await expect(owned.release()).resolves.toEqual({ status: 'succeeded' });
    });

    it('sandbox reset 首次失败仍释放 terminal，并允许下一次 release 完成恢复', async () => {
      const { cwd } = await createRunRoot();
      const owned = await createMacOsSandboxedOwnedPtyCommandProcess({
        executablePath: globalThis.process.execPath,
        argv: ['-e', 'process.stdout.write("__RESET_RETRY__")'],
        cwd,
        conversationRoot: cwd,
        environment: readHostEnvironment(),
        permissionLevel: 'standard',
        terminalSize: { columns: 80, rows: 24 },
      });
      const transcript = observeTranscript(owned.terminal).complete;
      await expect(owned.rootExit).resolves.toMatchObject({ exitCode: 0 });
      await expect(owned.treeEmpty).resolves.toEqual({ status: 'succeeded' });
      await transcript;

      const reset = vi.spyOn(SandboxManager, 'reset')
        .mockRejectedValueOnce(new Error('injected sandbox reset failure'));
      try {
        await expect(owned.release()).resolves.toMatchObject({
          status: 'failed',
          error: { message: 'injected sandbox reset failure' },
        });
        expect(owned.terminal.destroyed).toBe(true);
        await expect(owned.release()).resolves.toEqual({ status: 'succeeded' });
        expect(reset).toHaveBeenCalledTimes(2);
      } finally {
        reset.mockRestore();
      }
    });
  },
);
