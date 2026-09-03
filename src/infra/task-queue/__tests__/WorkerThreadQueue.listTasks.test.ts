/**
 * @file src/infra/task-queue/__tests__/WorkerThreadQueue.listTasks.test.ts
 *
 * @description
 * 功能 (What): 验证 WorkerThreadQueue.listTasks() 的“快照语义”
 * 输入 (Input): 构造若干任务
 * 输出 (Output): listTasks 返回浅拷贝数组，且不暴露内部 Map 引用
 * 副作用 (Side-effects): 无（不启动 Worker）
 */

import { describe, it, expect } from 'vitest';
import { WorkerThreadQueue, WorkerJobState } from '../WorkerThreadQueue';

type DummyPayload = { taskId: string; filename?: string; kbId: string; docId: string };

describe('WorkerThreadQueue.listTasks', () => {
  it('应返回任务快照数组，且修改返回对象不应影响队列内部状态', async () => {
    const queue = new WorkerThreadQueue<DummyPayload>({
      // maxConcurrency=0 时只记录 job，不启动 Worker。
      // 但为了更稳，这里将并发设为 0，避免触发执行（calculateOptimalConcurrency 默认 >= 1）
      maxConcurrency: 0,
      workerScript: __filename, // 不会被用到
    });

    await queue.addTask({ taskId: 't1', kbId: 'kb1', docId: 'd1' });
    await queue.addTask({ taskId: 't2', kbId: 'kb1', docId: 'd2' });

    const snapshot = queue.listTasks();
    expect(snapshot.length).toBe(2);
    expect(snapshot.some((t) => t.id === 't1')).toBe(true);

    // 修改快照对象不应影响队列内部任务
    // listTasks 返回浅拷贝，修改快照对象不能污染队列内部 WorkerJob。
    snapshot[0]!.state = WorkerJobState.COMPLETED;
    const t1 = queue.getTask('t1');
    expect(t1?.state).toBe(WorkerJobState.PENDING);
  });
});
