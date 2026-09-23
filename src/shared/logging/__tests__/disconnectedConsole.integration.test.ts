import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';
import { projectDiagnosticLogEntry } from '../functions/projectDiagnosticLogEntry';
import { DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS } from '../definitions/diagnosticLogContract';
import { createDiagnosticLogConsoleOutput } from '../orchestration/createDiagnosticLogConsoleOutput';

it('终端同步写入失败后停止重试', () => {
  let attempts = 0;
  const stream = new Writable({
    write() {
      attempts += 1;
      throw new Error('terminal write failed synchronously');
    },
  });
  const write = createDiagnosticLogConsoleOutput(stream);
  const info = projectDiagnosticLogEntry({
    receivedAt: new Date(), level: 'INFO', module: 'test', message: 'broken terminal',
  }, DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS);
  write(info);
  write(info);
  expect(attempts).toBe(1);
  stream.destroy();
});

it.each([false, true])('终端断开=%s：重复日志不退出进程、不污染 stdout，且全部记录仍写入文件', async disconnected => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'linnya-disconnected-console-'));
  const child = fork(
    fileURLToPath(new URL('./fixtures/disconnectedConsole.fixture.ts', import.meta.url)),
    [path.join(directory, 'backend.log')],
    { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  const exited = once(child, 'exit');
  const messages: unknown[] = [];
  child.on('message', message => messages.push(message));
  let stdout = '';
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
  child.stderr?.resume();
  try {
    const ready = once(child, 'message');
    const initial = await Promise.race([
      ready,
      exited.then(() => { throw new Error('fixture exited before becoming ready'); }),
    ]);
    expect(initial[0]).toBe('ready');
    if (!child.stdout || !child.stderr) throw new Error('fixture pipes are missing');
    if (disconnected) {
      const closed = Promise.all([once(child.stdout, 'close'), once(child.stderr, 'close')]);
      child.stdout.destroy();
      child.stderr.destroy();
      await closed;
    }
    child.send('write-after-disconnect');
    expect(await exited, JSON.stringify(messages)).toEqual([0, null]);
    expect(stdout).toBe('');

    const files = (await readdir(directory)).filter(name => name.startsWith('backend-'));
    expect(files).toHaveLength(1);
    const file = files[0];
    if (!file) throw new Error('file log is missing');
    const content = await readFile(path.join(directory, file), 'utf8');
    for (let iteration = 0; iteration < 3; iteration += 1) {
      for (const level of ['debug', 'info', 'warn', 'error']) {
        expect(content).toContain(`${level}-${iteration}`);
      }
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
