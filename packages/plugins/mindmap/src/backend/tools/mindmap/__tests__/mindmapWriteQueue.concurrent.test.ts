/**
 * @file mindmapWriteQueue.concurrent.test.ts
 * @description MindMap 写入队列并发一致性测试
 *
 * 中文说明：
 * - 测试 withMindMapWriteLock 在并行写入同一 documentId 时的串行化行为
 * - 测试不同 documentId 之间的完全并行
 * - 测试 AbortSignal 和超时机制
 * - 不依赖真实数据库，只测队列原语本身
 */

import { describe, it, expect, vi } from 'vitest';
import {
  withMindMapWriteLock,
  getMindMapWriteQueueDepth,
} from '../mindmapWriteQueue';

/**
 * 辅助工具：创建一个可控的延迟 Promise
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('MindMapWriteQueue 并发一致性', () => {
  // ========================================================================
  // 基础：同一 documentId 串行化
  // ========================================================================

  it('同一 documentId 的多个并发写入应严格 FIFO 串行执行', async () => {
    const documentId = 'doc-serial-test';
    const executionOrder: number[] = [];

    // 同时发起 5 个写入
    const promises = Array.from({ length: 5 }, (_, i) =>
      withMindMapWriteLock({
        documentId,
        purpose: 'create_node',
        fn: async () => {
          executionOrder.push(i);
          // 模拟写入耗时
          await delay(10);
          return i;
        },
      })
    );

    const results = await Promise.all(promises);

    // 验证：执行顺序严格按入队顺序（FIFO）
    expect(executionOrder).toEqual([0, 1, 2, 3, 4]);

    // 验证：每个调用都返回了正确的结果
    for (let i = 0; i < 5; i++) {
      expect(results[i].result).toBe(i);
    }
  });

  it('同一 documentId 的串行写入应累积"版本"（模拟 CAS 场景）', async () => {
    const documentId = 'doc-version-test';
    // 模拟共享状态：当前版本号
    let currentVersion = 0;

    const promises = Array.from({ length: 10 }, (_, i) =>
      withMindMapWriteLock({
        documentId,
        purpose: 'create_node',
        fn: async () => {
          // 模拟"读取最新版本"
          const baseVersion = currentVersion;
          // 模拟"apply + save"
          await delay(5);
          currentVersion = baseVersion + 1;
          return { index: i, baseVersion, newVersion: currentVersion };
        },
      })
    );

    const results = await Promise.all(promises);

    // 验证：最终版本号 = 初始版本 + 写入次数
    expect(currentVersion).toBe(10);

    // 验证：每次写入的 baseVersion 是上一次写入的 newVersion
    for (let i = 0; i < 10; i++) {
      expect(results[i].result.baseVersion).toBe(i);
      expect(results[i].result.newVersion).toBe(i + 1);
    }
  });

  // ========================================================================
  // 不同 documentId 完全并行
  // ========================================================================

  it('不同 documentId 的写入应完全并行（互不阻塞）', async () => {
    const startTime = Date.now();
    const sleepMs = 50;

    // 3 个不同的文档，各自持锁 50ms
    const promises = ['doc-A', 'doc-B', 'doc-C'].map((docId) =>
      withMindMapWriteLock({
        documentId: docId,
        purpose: 'create_node',
        fn: async () => {
          await delay(sleepMs);
          return docId;
        },
      })
    );

    await Promise.all(promises);
    const elapsed = Date.now() - startTime;

    // 验证：总耗时应"明显快于串行"（< 2 × sleepMs = 100ms），而非 3 × sleepMs (150ms) 的串行。
    //
    // 历史：之前断言是 `< sleepMs + 30 = 80ms`，在 vitest worker 池高负载时
    // setTimeout 50ms 会被调度延迟到 80-100ms，导致假阳性 fail（实际仍并行）。
    // 改成 `< 2 × sleepMs` 是测"并行 vs 串行"的语义差，而非绝对时间——
    // 既能可靠拦住真退化（串行 150ms 必然 fail），又抗 CI/本地负载抖动。
    expect(elapsed).toBeLessThan(sleepMs * 2);
  });

  // ========================================================================
  // 可观测指标（metrics）
  // ========================================================================

  it('应返回正确的 metrics（queueDepthOnEnqueue / queuedMs / lockHeldMs）', async () => {
    const documentId = 'doc-metrics-test';

    // 先占住锁一段时间
    const longTask = withMindMapWriteLock({
      documentId,
      purpose: 'create_node',
      fn: async () => {
        await delay(50);
        return 'first';
      },
    });

    // 稍等一下确保第一个任务已入队并开始执行
    await delay(5);

    // 第二个任务需要等第一个完成才能执行
    const shortTask = withMindMapWriteLock({
      documentId,
      purpose: 'other',
      fn: async () => {
        await delay(10);
        return 'second';
      },
    });

    const [r1, r2] = await Promise.all([longTask, shortTask]);

    // 第一个任务：队列深度应为 0（入队时没人在前面）
    expect(r1.metrics.queueDepthOnEnqueue).toBe(0);
    expect(r1.metrics.lockHeldMs).toBeGreaterThanOrEqual(45);

    // 第二个任务：队列深度应为 1（第一个任务在执行中）
    expect(r2.metrics.queueDepthOnEnqueue).toBe(1);
    // 排队时间应大于 0（等待第一个任务完成）
    expect(r2.metrics.queuedMs).toBeGreaterThan(0);
  });

  // ========================================================================
  // AbortSignal
  // ========================================================================

  it('排队前已 abort 的信号应立刻拒绝（不进入临界区）', async () => {
    const controller = new AbortController();
    controller.abort(); // 立即 abort

    await expect(
      withMindMapWriteLock({
        documentId: 'doc-abort-before',
        purpose: 'create_node',
        abortSignal: controller.signal,
        fn: async () => 'should not run',
      })
    ).rejects.toThrow(/排队前已被用户终止/);
  });

  it('排队期间 abort 应在轮到时拒绝进入临界区', async () => {
    const documentId = 'doc-abort-during';
    const controller = new AbortController();

    // 先占锁
    const blocker = withMindMapWriteLock({
      documentId,
      purpose: 'create_node',
      fn: async () => {
        await delay(100);
        return 'blocker';
      },
    });

    // 排队的任务，带 AbortSignal
    const waiter = withMindMapWriteLock({
      documentId,
      purpose: 'other',
      abortSignal: controller.signal,
      fn: async () => 'should not run',
    });

    // 50ms 后 abort（此时 waiter 还在排队）
    await delay(50);
    controller.abort();

    // blocker 应成功
    const blockerResult = await blocker;
    expect(blockerResult.result).toBe('blocker');

    // waiter 应被拒绝
    await expect(waiter).rejects.toThrow(/被用户终止/);
  });

  // ========================================================================
  // 超时机制
  // ========================================================================

  it('排队超时应拒绝进入临界区', async () => {
    const documentId = 'doc-timeout';

    // 先占锁较长时间
    const blocker = withMindMapWriteLock({
      documentId,
      purpose: 'create_node',
      fn: async () => {
        await delay(200);
        return 'blocker';
      },
    });

    // 排队超时 = 50ms（blocker 要 200ms 才释放，必然超时）
    const waiter = withMindMapWriteLock({
      documentId,
      purpose: 'other',
      timeoutMs: 50,
      fn: async () => 'should not run',
    });

    await expect(waiter).rejects.toThrow(/排队超时/);

    // blocker 正常完成
    const blockerResult = await blocker;
    expect(blockerResult.result).toBe('blocker');
  });

  // ========================================================================
  // 错误传播
  // ========================================================================

  it('临界区内的错误应透传给调用方，且不影响后续排队者', async () => {
    const documentId = 'doc-error-passthrough';
    const executionOrder: string[] = [];

    // 任务 1：成功
    const task1 = withMindMapWriteLock({
      documentId,
      purpose: 'create_node',
      fn: async () => {
        executionOrder.push('task1');
        return 'ok1';
      },
    });

    // 任务 2：抛错
    const task2 = withMindMapWriteLock({
      documentId,
      purpose: 'create_node',
      fn: async () => {
        executionOrder.push('task2');
        throw new Error('模拟写入失败');
      },
    });

    // 任务 3：应该正常执行（不受 task2 影响）
    const task3 = withMindMapWriteLock({
      documentId,
      purpose: 'other',
      fn: async () => {
        executionOrder.push('task3');
        return 'ok3';
      },
    });

    const r1 = await task1;
    expect(r1.result).toBe('ok1');

    await expect(task2).rejects.toThrow('模拟写入失败');

    const r3 = await task3;
    expect(r3.result).toBe('ok3');

    // 验证执行顺序
    expect(executionOrder).toEqual(['task1', 'task2', 'task3']);
  });

  // ========================================================================
  // 队列深度查询
  // ========================================================================

  it('getMindMapWriteQueueDepth 应正确反映排队深度', async () => {
    const documentId = 'doc-depth-query';

    // 初始深度为 0
    expect(getMindMapWriteQueueDepth(documentId)).toBe(0);

    let resolveBlocker: (() => void) | undefined;
    const blockerReady = new Promise<void>((resolve) => {
      resolveBlocker = resolve;
    });

    // 开始一个任务，但不让它结束
    const blocker = withMindMapWriteLock({
      documentId,
      purpose: 'create_node',
      fn: () =>
        new Promise<string>((resolve) => {
          resolveBlocker!();
          // 用 setTimeout 让它暂停，直到外部释放
          const id = setInterval(() => {
            // 等待外部标记
            if ((globalThis as Record<string, unknown>).__testReleaseBlocker) {
              clearInterval(id);
              delete (globalThis as Record<string, unknown>).__testReleaseBlocker;
              resolve('done');
            }
          }, 5);
        }),
    });

    await blockerReady;

    // blocker 在执行中，深度 = 1
    expect(getMindMapWriteQueueDepth(documentId)).toBe(1);

    // 再排 2 个
    const w1 = withMindMapWriteLock({
      documentId,
      purpose: 'other',
      fn: async () => 'w1',
    });
    const w2 = withMindMapWriteLock({
      documentId,
      purpose: 'other',
      fn: async () => 'w2',
    });

    await delay(5);
    // 深度 = 3（1 执行中 + 2 排队）
    expect(getMindMapWriteQueueDepth(documentId)).toBe(3);

    // 释放 blocker
    (globalThis as Record<string, unknown>).__testReleaseBlocker = true;

    await Promise.all([blocker, w1, w2]);

    // 全部完成，深度回到 0
    expect(getMindMapWriteQueueDepth(documentId)).toBe(0);
  });

  // ========================================================================
  // 混合场景：同文档+不同文档同时并行
  // ========================================================================

  it('同文档串行 + 不同文档并行的混合场景应正确调度', async () => {
    const docAOrder: number[] = [];
    const docBOrder: number[] = [];

    // docA：3 个串行任务
    const docATasks = Array.from({ length: 3 }, (_, i) =>
      withMindMapWriteLock({
        documentId: 'doc-mix-A',
        purpose: 'create_node',
        fn: async () => {
          docAOrder.push(i);
          await delay(10);
          return `A-${i}`;
        },
      })
    );

    // docB：3 个串行任务（与 docA 完全并行）
    const docBTasks = Array.from({ length: 3 }, (_, i) =>
      withMindMapWriteLock({
        documentId: 'doc-mix-B',
        purpose: 'other',
        fn: async () => {
          docBOrder.push(i);
          await delay(10);
          return `B-${i}`;
        },
      })
    );

    await Promise.all([...docATasks, ...docBTasks]);

    // 同文档内严格 FIFO
    expect(docAOrder).toEqual([0, 1, 2]);
    expect(docBOrder).toEqual([0, 1, 2]);
  });
});
