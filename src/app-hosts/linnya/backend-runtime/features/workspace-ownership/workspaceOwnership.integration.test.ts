import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { acquireWorkspaceRuntimeOwnership } from './acquireWorkspaceRuntimeOwnership';

describe('Workspace runtime ownership', () => {
  it('拒绝第二个进程；杀死原 owner 后无需删除锁文件即可接管', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'linnya-owner-lock-'));
    const sqliteModule = createRequire(import.meta.url).resolve('better-sqlite3');
    const child = spawn(
      process.execPath,
      [
        '-e',
        `
      const Database = require(process.argv[1]);
      const db = new Database(process.argv[2], { timeout: 0 });
      db.exec('BEGIN EXCLUSIVE');
      process.stdout.write('locked');
      process.stdin.resume();
    `,
        sqliteModule,
        join(directory, '.runtime-owner.lock'),
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    try {
      await once(child.stdout, 'data');
      expect(() => acquireWorkspaceRuntimeOwnership(directory)).toThrow('已有运行中的 Backend');
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
      const ownership = acquireWorkspaceRuntimeOwnership(directory);
      try {
        expect(() => acquireWorkspaceRuntimeOwnership(directory)).toThrow('已有运行中的 Backend');
      } finally {
        ownership.release();
      }
      acquireWorkspaceRuntimeOwnership(directory).release();
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
