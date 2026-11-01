import { createServer } from 'node:http';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { CommandPermissionLevel } from '@app/schemas/commands';
import { afterEach, describe, expect, it } from 'vitest';

import { createMacOsSandboxedOwnedPipeCommandProcess } from '../createMacOsSandboxedOwnedPipeCommandProcess';

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

function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  return new Promise<Buffer>((resolve, reject) => {
    stream.once('end', () => resolve(Buffer.concat(chunks)));
    stream.once('error', reject);
  });
}

async function createRunRoot(): Promise<{ readonly cwd: string; readonly adjacent: string }> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-macos-sandboxed-owner-'));
  roots.push(root);
  const cwd = path.join(root, '对话 目录');
  const adjacent = path.join(root, '相邻目录');
  await Promise.all([
    fsp.mkdir(cwd, { recursive: true }),
    fsp.mkdir(adjacent, { recursive: true }),
  ]);
  return { cwd, adjacent };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fsp.stat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function runNode(input: {
  readonly cwd: string;
  readonly conversationRoot?: string;
  readonly permissionLevel: CommandPermissionLevel;
  readonly script: string;
  readonly argv?: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
}): Promise<{ readonly exitCode: number | null; readonly stdout: string; readonly stderr: string }> {
  const ownedProcess = await createMacOsSandboxedOwnedPipeCommandProcess({
    executablePath: globalThis.process.execPath,
    argv: ['-e', input.script, ...(input.argv ?? [])],
    cwd: input.cwd,
    conversationRoot: input.conversationRoot ?? input.cwd,
    environment: input.environment ?? readHostEnvironment(),
    permissionLevel: input.permissionLevel,
  });
  const stdout = collect(ownedProcess.stdout);
  const stderr = collect(ownedProcess.stderr);
  const rootExit = await ownedProcess.rootExit;
  await expect(ownedProcess.stopAndWaitForTreeEmpty()).resolves.toEqual({ status: 'succeeded' });
  const [stdoutBytes, stderrBytes] = await Promise.all([stdout, stderr]);
  await expect(ownedProcess.release()).resolves.toEqual({ status: 'succeeded' });
  return {
    exitCode: rootExit.exitCode,
    stdout: stdoutBytes.toString('utf8'),
    stderr: stderrBytes.toString('utf8'),
  };
}

describe.skipIf(globalThis.process.platform !== 'darwin')(
  'macOS sandboxed process-group owned pipe process',
  () => {
    it('按只读、标准、完全访问冻结三档真实写入边界', async () => {
      const { cwd, adjacent } = await createRunRoot();
      const script = `
        const fs = require('node:fs');
        const outcomes = process.argv.slice(1).map(target => {
          try { fs.writeFileSync(target, 'written'); return 'written'; }
          catch { return 'denied'; }
        });
        process.stdout.write(JSON.stringify(outcomes));
      `;

      const readOnlyFiles = [path.join(cwd, 'read-only-cwd.txt'), path.join(adjacent, 'read-only-adjacent.txt')];
      const readOnly = await runNode({
        cwd,
        permissionLevel: 'read_only',
        script,
        argv: readOnlyFiles,
      });
      expect(readOnly.exitCode).toBe(0);
      expect(JSON.parse(readOnly.stdout)).toEqual(['denied', 'denied']);

      const standardFiles = [path.join(cwd, 'standard-cwd.txt'), path.join(adjacent, 'standard-adjacent.txt')];
      const standard = await runNode({
        cwd,
        permissionLevel: 'standard',
        script,
        argv: standardFiles,
      });
      expect(standard.exitCode).toBe(0);
      expect(JSON.parse(standard.stdout)).toEqual(['written', 'denied']);

      const standardFromExternalCwdFiles = [
        path.join(adjacent, 'external-cwd.txt'),
        path.join(cwd, 'conversation-root-from-external-cwd.txt'),
      ];
      const standardFromExternalCwd = await runNode({
        cwd: adjacent,
        conversationRoot: cwd,
        permissionLevel: 'standard',
        script,
        argv: standardFromExternalCwdFiles,
      });
      expect(standardFromExternalCwd.exitCode).toBe(0);
      expect(JSON.parse(standardFromExternalCwd.stdout)).toEqual(['denied', 'written']);

      const fullAccessFiles = [path.join(cwd, 'full-cwd.txt'), path.join(adjacent, 'full-adjacent.txt')];
      const fullAccess = await runNode({
        cwd,
        permissionLevel: 'full_access',
        script,
        argv: fullAccessFiles,
      });
      expect(fullAccess.exitCode).toBe(0);
      expect(JSON.parse(fullAccess.stdout)).toEqual(['written', 'written']);

      await expect(Promise.all([
        ...readOnlyFiles.map(exists),
        exists(standardFiles[1]),
        exists(standardFromExternalCwdFiles[0]),
      ])).resolves.toEqual([false, false, false, false]);
      await expect(Promise.all([
        fsp.readFile(standardFiles[0], 'utf8'),
        ...fullAccessFiles.map(file => fsp.readFile(file, 'utf8')),
        fsp.readFile(standardFromExternalCwdFiles[1], 'utf8'),
      ])).resolves.toEqual(['written', 'written', 'written', 'written']);
    });

    it('保留冻结环境，并在标准模式保持本地网络开放', async () => {
      const { cwd } = await createRunRoot();
      const server = createServer((_request, response) => {
        response.end('linnya-network-open');
      });
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      try {
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('HTTP test server has no TCP port');
        const environment = {
          ...readHostEnvironment(),
          LINNYA_FROZEN_ENV_SAMPLE: '中文 value with spaces',
        };
        const result = await runNode({
          cwd,
          permissionLevel: 'standard',
          environment,
          script: `
            const http = require('node:http');
            http.get(process.argv[1], response => {
              let body = '';
              response.setEncoding('utf8');
              response.on('data', chunk => { body += chunk; });
              response.on('end', () => process.stdout.write(JSON.stringify({
                body,
                environment: process.env.LINNYA_FROZEN_ENV_SAMPLE,
              })));
            }).on('error', error => { throw error; });
          `,
          argv: [`http://127.0.0.1:${address.port}/probe`],
        });
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
          body: 'linnya-network-open',
          environment: '中文 value with spaces',
        });
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve());
        });
      }
    });

    it('把复杂 argv 原样交给用户进程，不重新解释成 Shell 语法', async () => {
      const { cwd } = await createRunRoot();
      const argumentsToPreserve = [
        '',
        'space value',
        "single'quote",
        '$(touch should-not-run)',
        'line one\nline two',
        '中文/路径',
      ];
      const result = await runNode({
        cwd,
        permissionLevel: 'standard',
        script: 'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
        argv: argumentsToPreserve,
      });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(argumentsToPreserve);
      await expect(fsp.stat(path.join(cwd, 'should-not-run'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('sandbox 后续 spawn 失败时不会裸跑，并在 reset 后允许下一条命令启动', async () => {
      const { cwd } = await createRunRoot();
      await expect(createMacOsSandboxedOwnedPipeCommandProcess({
        executablePath: globalThis.process.execPath,
        argv: [],
        cwd: path.join(cwd, 'missing-working-directory'),
        conversationRoot: cwd,
        environment: readHostEnvironment(),
        permissionLevel: 'standard',
      })).rejects.toMatchObject({
        name: 'MacOsOwnedPipeCommandProcessLaunchError',
        stage: 'process_owner',
        cause: { code: 'ENOENT' },
      });

      const recovered = await runNode({
        cwd,
        permissionLevel: 'standard',
        script: "process.stdout.write('recovered')",
      });
      expect(recovered).toMatchObject({ exitCode: 0, stdout: 'recovered' });
    });
  },
);
