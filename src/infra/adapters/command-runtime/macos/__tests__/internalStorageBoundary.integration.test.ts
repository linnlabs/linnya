import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { CommandPermissionLevel } from '@app/schemas/commands';
import { afterEach, describe, expect, it } from 'vitest';

import { createMacOsSandboxedOwnedPipeCommandProcess } from '../createMacOsSandboxedOwnedPipeCommandProcess';
import { createMacOsSandboxedOwnedPtyCommandProcess } from '../createMacOsSandboxedOwnedPtyCommandProcess';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fsp.rm(root, { recursive: true, force: true })));
});

function collect(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  return new Promise((resolve, reject) => {
    stream.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.once('error', reject);
  });
}

describe.skipIf(process.platform !== 'darwin')('内部存储真实进程边界', () => {
  it.each(['pipe', 'pty'] as const)('%s：1/2 档阻止脚本和子进程读取，批准及完全访问按范围放行', async mode => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-storage-boundary-'));
    roots.push(root);
    const appData = path.join(root, 'app-data[1]');
    const workspace = path.join(root, 'workspace-data');
    const current = path.join(appData, 'conversations', 'current');
    const other = path.join(appData, 'conversations', 'other');
    const launcher = path.join(appData, 'managed-cli');
    await Promise.all([current, other, launcher, workspace].map(dir => fsp.mkdir(dir, { recursive: true })));
    const targets = [
      path.join(appData, 'credentials.json'),
      path.join(workspace, 'workspace.sqlite'),
      path.join(other, 'private.txt'),
      path.join(current, 'input.txt'),
      path.join(launcher, 'client.txt'),
      path.join(root, 'external.txt'),
    ];
    await Promise.all(targets.map(target => fsp.writeFile(target, 'fixture-data')));
    const alias = path.join(current, 'credential-alias');
    await fsp.symlink(targets[0], alias);
    const cases: readonly { level: CommandPermissionLevel; granted: boolean; allowed: boolean }[] = [
      { level: 'read_only', granted: false, allowed: false },
      { level: 'standard', granted: false, allowed: false },
      { level: 'read_only', granted: true, allowed: true },
      { level: 'standard', granted: true, allowed: true },
      { level: 'full_access', granted: false, allowed: true },
    ];
    // 用 Node 再启动另一个 Node 读取，确认边界属于进程树而非 Shell 命令字匹配。
    const script = `
      const fs = require('node:fs');
      const cp = require('node:child_process');
      const read = p => { try { fs.readFileSync(p); return 'read'; } catch { return 'denied'; } };
      const targets = process.argv.slice(1);
      const direct = targets.map(read);
      const child = cp.execFileSync(process.execPath, ['-e',
        "try { require('node:fs').readFileSync(process.argv[1]); process.stdout.write('read'); } catch { process.stdout.write('denied'); }",
        targets[0]], { encoding: 'utf8' });
      let write;
      try { fs.writeFileSync(targets[0], 'changed'); write = 'written'; } catch { write = 'denied'; }
      process.stdout.write('__RESULT__' + JSON.stringify({ direct, child, write }) + '__END__');
    `;
    for (const scenario of cases) {
      const launch = {
        executablePath: process.execPath,
        argv: ['-e', script, ...targets, alias],
        cwd: current,
        environment: { PATH: '/usr/bin:/bin', HOME: os.homedir() },
        conversationRoot: current,
        permissionLevel: scenario.level,
        internalStorage: { protected_roots: [appData, workspace], readable_roots: [launcher] },
        internalStorageAccess: scenario.granted,
      };
      let output: string;
      if (mode === 'pipe') {
        const owned = await createMacOsSandboxedOwnedPipeCommandProcess(launch);
        const stdout = collect(owned.stdout);
        const stderr = collect(owned.stderr);
        try {
          expect((await owned.rootExit).exitCode).toBe(0);
          output = await stdout;
          expect(await stderr).toBe('');
        } finally {
          await owned.stopAndWaitForTreeEmpty();
          await owned.release();
        }
      } else {
        const owned = await createMacOsSandboxedOwnedPtyCommandProcess({
          ...launch, terminalSize: { columns: 80, rows: 24 },
        });
        const transcript = collect(owned.terminal);
        try {
          expect((await owned.rootExit).exitCode).toBe(0);
          output = await transcript;
        } finally {
          await owned.stopAndWaitForTreeEmpty();
          await owned.release();
        }
      }
      const match = /__RESULT__(.*?)__END__/u.exec(output);
      expect(match).not.toBeNull();
      const access = scenario.allowed ? 'read' : 'denied';
      expect(JSON.parse(match?.[1] ?? 'null')).toEqual({
        direct: [access, access, access, 'read', 'read', 'read', access],
        child: access,
        write: scenario.level === 'full_access' || (scenario.level === 'standard' && scenario.granted)
          ? 'written' : 'denied',
      });
    }
  });
});
