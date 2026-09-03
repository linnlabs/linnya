import { describe, expect, it, vi } from 'vitest';
import { PromptKeys } from '@app/schemas';
import { createToolContextFixture } from 'linnkit/testkit';
import type { RegisteredChildRunInvokerPort } from 'src/app-hosts/linnya/adapters/child-runs/registeredSubagentInvoker';
import { runRegisteredSubagent, runRegisteredSubagentsInParallel } from '../subagentRunner';
import { buildSubrunBatchResult } from 'src/tools/agent_control/subrun/batch';

describe('runRegisteredSubagentsInParallel', () => {
  it('应同时保持三个 child run in-flight，并保持输入顺序返回', async () => {
    let activeCount = 0;
    let peakActiveCount = 0;
    let releaseRuns: (() => void) | undefined;
    const releasePromise = new Promise<void>((resolve) => {
      releaseRuns = resolve;
    });

    const invoker: RegisteredChildRunInvokerPort = {
      async invoke(params) {
        expect(params.executionPolicy?.modelId).toBe('parent-selected-model');
        expect(params.tracePolicy).toMatchObject({
          parentToolCallId: 'parent-call-parallel',
        });
        activeCount += 1;
        peakActiveCount = Math.max(peakActiveCount, activeCount);
        await releasePromise;
        activeCount -= 1;
        const subrunId = params.tracePolicy?.subrunId ?? 'missing-subrun-id';
        return {
          promptKey: params.promptKey,
          subrunId,
          success: true,
          finalAnswer: `done:${subrunId}`,
          events: [],
          stepCount: 1,
        };
      },
    };

    const context = createToolContextFixture({
      patch: {
        parentToolCallId: 'parent-call-parallel',
        createSubRunTracePublisher: () => ({ publish: vi.fn() }),
        registeredChildRunInvoker: invoker,
      },
    });
    const running = runRegisteredSubagentsInParallel({
      context,
      maxConcurrency: 3,
      subruns: [0, 1, 2].map((index) => ({
        subrunId: `parallel-${index}`,
        promptKey: PromptKeys.DEFAULT,
        description: `任务 ${index}`,
        userMessage: `执行任务 ${index}`,
        inheritTurns: 0,
        maxSteps: 2,
        modelId: 'parent-selected-model',
        subrunSource: 'test:parallel',
        subrunMetadata: { index },
      })),
    });

    await vi.waitFor(() => {
      expect(activeCount).toBe(3);
    });
    releaseRuns?.();

    const results = await running;
    expect(peakActiveCount).toBe(3);
    expect(results.map((result) => result.subrunId)).toEqual([
      'parallel-0',
      'parallel-1',
      'parallel-2',
    ]);
  });

  it('可见 child 缺少父工具锚点或 trace publisher 时应在启动前失败', async () => {
    const invoke = vi.fn<RegisteredChildRunInvokerPort['invoke']>();
    const base = {
      promptKey: PromptKeys.DEFAULT,
      description: '可见子任务',
      userMessage: '执行',
      inheritTurns: 0,
      maxSteps: 2,
      subrunSource: 'test:visible-child',
      subrunMetadata: {},
    };

    await expect(runRegisteredSubagent({
      ...base,
      context: createToolContextFixture({ patch: { registeredChildRunInvoker: { invoke } } }),
    })).rejects.toThrow('parentToolCallId is required');

    await expect(runRegisteredSubagent({
      ...base,
      context: createToolContextFixture({
        patch: {
          parentToolCallId: 'parent-call-without-publisher',
          registeredChildRunInvoker: { invoke },
        },
      }),
    })).rejects.toThrow('createSubRunTracePublisher is required');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('应把部分 child 取消原样交给 batch 聚合，而不是计为普通失败', async () => {
    const invoker: RegisteredChildRunInvokerPort = {
      async invoke(params) {
        const subrunId = params.tracePolicy?.subrunId ?? 'missing-subrun-id';
        if (subrunId === 'parallel-cancelled') {
          return {
            promptKey: params.promptKey,
            subrunId,
            success: false,
            cancelled: true,
            finalAnswer: '',
            error: 'cancelled by parent',
            events: [],
            stepCount: 0,
          };
        }
        return {
          promptKey: params.promptKey,
          subrunId,
          success: true,
          finalAnswer: `done:${subrunId}`,
          events: [],
          stepCount: 1,
        };
      },
    };
    const context = createToolContextFixture({
      patch: {
        parentToolCallId: 'parent-call-cancel',
        createSubRunTracePublisher: () => ({ publish: vi.fn() }),
        registeredChildRunInvoker: invoker,
      },
    });
    const subruns = [
      {
        unit_id: 'unit-completed',
        subrun_id: 'parallel-completed',
        description: '完成任务',
        prompt: '完成',
      },
      {
        unit_id: 'unit-cancelled',
        subrun_id: 'parallel-cancelled',
        description: '取消任务',
        prompt: '取消',
      },
    ];

    const childResults = await runRegisteredSubagentsInParallel({
      context,
      maxConcurrency: 2,
      subruns: subruns.map((subrun) => ({
        subrunId: subrun.subrun_id,
        promptKey: PromptKeys.DEFAULT,
        description: subrun.description,
        userMessage: subrun.prompt,
        inheritTurns: 0,
        maxSteps: 2,
        subrunSource: 'test:parallel-cancel',
        subrunMetadata: { unit_id: subrun.unit_id },
      })),
    });
    const batchResult = buildSubrunBatchResult({ subruns, childResults });

    expect(childResults[1]?.cancelled).toBe(true);
    expect(batchResult.data).toMatchObject({
      status: 'partial',
      succeeded: 1,
      failed: 0,
      cancelled: 1,
    });
    expect(batchResult.data.results[1]?.status).toBe('cancelled');
  });
});
