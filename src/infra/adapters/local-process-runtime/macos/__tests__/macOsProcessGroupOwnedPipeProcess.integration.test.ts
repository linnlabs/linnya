import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { afterEach, describe, expect, it } from 'vitest';

import { createMacOsProcessGroupOwnedPipeProcess } from '../createMacOsProcessGroupOwnedPipeProcess';

const fixturePath = path.resolve(
  globalThis.process.cwd(),
  'scripts/e2e/shell-tool/fixtures/process-trees/macos-process-group-tree.cjs',
);
// EOF 路径的 watchdog 先 sleep 0.4 秒才 KILL 自己；解除路径必须明显早于这个下限。
const RELEASED_WATCHDOG_TREE_EMPTY_MS = 300;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fsp.rm(root, { recursive: true, force: true })));
});

async function createRunRoot(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-macos-owned-process-'));
  roots.push(root);
  return root;
}

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

describe.skipIf(globalThis.process.platform !== 'darwin')(
  'macOS process-group owned pipe process',
  () => {
    it('根进程自然退出后仍收掉存活后代，并分别等待双流、tree empty 和资源释放', async () => {
      const runRoot = await createRunRoot();
      const ownedProcess = await createMacOsProcessGroupOwnedPipeProcess({
        executablePath: globalThis.process.execPath,
        argv: [fixturePath, runRoot, randomUUID(), 'root-exit'],
        cwd: runRoot,
        environment: readHostEnvironment(),
      });
      const stdout = collect(ownedProcess.stdout);
      const stderr = collect(ownedProcess.stderr);

      await expect(ownedProcess.rootExit).resolves.toMatchObject({ exitCode: 23, signal: null });
      await expect(ownedProcess.treeEmpty).resolves.toMatchObject({
        status: 'succeeded',
      });
      // 仍有后代时 watchdog 不能被提前解除：后代收到的是整组 TERM，而不是宽限期后的兜底 KILL。
      for (const role of ['child', 'grandchild']) {
        await expect(fsp.readFile(path.join(runRoot, `${role}.terminated`), 'utf8')).resolves.toBe('SIGTERM');
      }
      await expect(ownedProcess.rootClose).resolves.toBeUndefined();
      await expect(Promise.all([stdout, stderr])).resolves.toEqual([
        expect.any(Buffer),
        expect.any(Buffer),
      ]);
      await expect(ownedProcess.release()).resolves.toEqual({ status: 'succeeded' });
      await expect(ownedProcess.release()).resolves.toEqual({ status: 'succeeded' });
    });

    it('根进程自然退出且组内只剩 watchdog 时立即确认 tree empty，不等待宽限期', async () => {
      const runRoot = await createRunRoot();
      const ownedProcess = await createMacOsProcessGroupOwnedPipeProcess({
        executablePath: globalThis.process.execPath,
        argv: ['-e', 'process.stdout.write("done")'],
        cwd: runRoot,
        environment: readHostEnvironment(),
      });
      const stdout = collect(ownedProcess.stdout);
      const stderr = collect(ownedProcess.stderr);

      await expect(ownedProcess.rootExit).resolves.toMatchObject({ exitCode: 0, signal: null });
      const rootExitedAt = performance.now();
      await expect(ownedProcess.treeEmpty).resolves.toEqual({ status: 'succeeded' });
      expect(performance.now() - rootExitedAt).toBeLessThan(RELEASED_WATCHDOG_TREE_EMPTY_MS);
      await expect(stdout).resolves.toEqual(Buffer.from('done'));
      await stderr;
      await expect(ownedProcess.release()).resolves.toEqual({ status: 'succeeded' });
    });

    it('release 会先走同一条幂等收树链，不能把资源关闭冒充 tree-empty', async () => {
      const runRoot = await createRunRoot();
      const ownedProcess = await createMacOsProcessGroupOwnedPipeProcess({
        executablePath: globalThis.process.execPath,
        argv: [fixturePath, runRoot, randomUUID(), 'ignore-term'],
        cwd: runRoot,
        environment: readHostEnvironment(),
      });
      const stdout = collect(ownedProcess.stdout);
      const stderr = collect(ownedProcess.stderr);

      await expect(ownedProcess.release()).resolves.toEqual({ status: 'succeeded' });
      await Promise.all([stdout, stderr]);
      await expect(ownedProcess.stopAndWaitForTreeEmpty()).resolves.toEqual({ status: 'succeeded' });
    });

    it('并发停止只执行一条收树链，忽略 TERM 的后代会在有限时间内归零', async () => {
      const runRoot = await createRunRoot();
      const ownedProcess = await createMacOsProcessGroupOwnedPipeProcess({
        executablePath: globalThis.process.execPath,
        argv: [fixturePath, runRoot, randomUUID(), 'ignore-term'],
        cwd: runRoot,
        environment: readHostEnvironment(),
      });
      const stdout = collect(ownedProcess.stdout);
      const stderr = collect(ownedProcess.stderr);

      const firstStop = ownedProcess.stopAndWaitForTreeEmpty();
      const secondStop = ownedProcess.stopAndWaitForTreeEmpty();
      expect(secondStop).toBe(firstStop);
      await expect(firstStop).resolves.toMatchObject({ status: 'succeeded' });
      await expect(ownedProcess.rootExit).resolves.toMatchObject({ signal: 'SIGTERM' });
      await Promise.all([stdout, stderr]);
      await expect(ownedProcess.release()).resolves.toEqual({ status: 'succeeded' });
    });

    it('可信 executable 不存在时在 readiness 前失败，不把 wrapper 当成用户进程成功', async () => {
      const runRoot = await createRunRoot();
      await expect(createMacOsProcessGroupOwnedPipeProcess({
        executablePath: path.join(runRoot, 'missing-shell'),
        argv: [],
        cwd: runRoot,
        environment: {},
      })).rejects.toThrow(/before readiness|closed before readiness/u);
    });

    it('启动阶段 owner 结束时关闭闸门，不放行用户代码后再补做清理', async () => {
      const runRoot = await createRunRoot();
      const sideEffectPath = path.join(runRoot, 'must-not-exist.txt');
      const controller = new AbortController();
      const launch = createMacOsProcessGroupOwnedPipeProcess({
        executablePath: globalThis.process.execPath,
        argv: ['-e', 'require("node:fs").writeFileSync(process.argv[1], "ran")', sideEffectPath],
        cwd: runRoot,
        environment: readHostEnvironment(),
      }, { abortSignal: controller.signal });

      controller.abort();
      await expect(launch).rejects.toMatchObject({ name: 'AbortError' });
      await expect(fsp.stat(sideEffectPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  },
);
