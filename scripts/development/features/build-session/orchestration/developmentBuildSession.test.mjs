import { describe, expect, it } from 'vitest';
import { createDevelopmentProcessScope } from './createDevelopmentProcessScope.mjs';
import { runDevelopmentBuildGraph } from './runDevelopmentBuildGraph.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('开发构建会话', () => {
  it('独立任务并行，共享依赖只构建一次，后继严格等待本轮成功', async () => {
    const schema = Promise.withResolvers();
    const started = [];
    const tasks = [
      { id: 'schemas' }, { id: 'runtime' },
      { id: 'backend', dependencies: ['schemas'] },
      { id: 'plugin', dependencies: ['schemas'] },
    ];
    const run = runDevelopmentBuildGraph(tasks, task => {
      started.push(task.id);
      return { ready: task.id === 'schemas' ? schema.promise : Promise.resolve() };
    });
    await Promise.resolve();
    expect(started).toEqual(['schemas', 'runtime']);
    schema.resolve();
    await run;
    expect(started).toEqual(['schemas', 'runtime', 'backend', 'plugin']);
  });

  it('编译失败不会放行消费者，也不接受磁盘上的旧文件作为 ready', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-dev-build-'));
    const scope = createDevelopmentProcessScope();
    try {
      await writeFile(path.join(root, 'old.cjs'), 'old build');
      const script = path.join(root, 'watch.cjs');
      await writeFile(script, "process.send({type:'build-error'}); process.on('message', () => process.exit(0));");
      const started = [];
      await expect(runDevelopmentBuildGraph([
        { id: 'compile', cwd: root, file: script, args: [], watch: true },
        { id: 'electron', dependencies: ['compile'] },
      ], task => { started.push(task.id); return scope.start(task); })).rejects.toThrow('首次构建失败');
      expect(started).toEqual(['compile']);
    } finally {
      await scope.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('成功事件让 watcher 保持运行，关闭会话后进程退出', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-dev-build-'));
    const scope = createDevelopmentProcessScope();
    try {
      const script = path.join(root, 'watch.cjs');
      await writeFile(script, "process.send({type:'build-ready'}); process.on('message', () => process.exit(0));");
      const process = scope.start({ id: 'watch', cwd: root, file: script, args: [], watch: true });
      await process.ready;
      await scope.stop();
      await expect(process.done).resolves.toBeUndefined();
    } finally {
      await scope.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});
