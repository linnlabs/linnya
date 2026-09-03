import { describe, expect, it } from 'vitest';
import { runTickPipeline } from '../runTickPipeline';
import type { TickAroundMiddleware, TickStage } from '../types';
import { createTestTickPipelineContext } from './createTestTickPipelineContext';

function createPipelineContext() {
  return createTestTickPipelineContext({
    context: {
      conversationId: 'conv_tick_pipeline',
      turnId: 'turn_tick_pipeline',
    },
  });
}

describe('runTickPipeline', () => {
  it('按固定 stage 顺序执行，并对每个 stage 应用 around middleware 包裹顺序', async () => {
    const ctx = createPipelineContext();
    const calls: string[] = [];

    const stages: TickStage[] = [
      {
        id: 'prepare_call',
        reads: [],
        writes: [],
        async run() {
          calls.push('stage:prepare_call');
        },
      },
      {
        id: 'execute_llm',
        reads: [],
        writes: [],
        async run() {
          calls.push('stage:execute_llm');
        },
      },
    ];

    const outer: TickAroundMiddleware = async (_ctx, stage, next) => {
      calls.push(`outer:before:${stage.id}`);
      await next();
      calls.push(`outer:after:${stage.id}`);
    };
    const inner: TickAroundMiddleware = async (_ctx, stage, next) => {
      calls.push(`inner:before:${stage.id}`);
      await next();
      calls.push(`inner:after:${stage.id}`);
    };

    await runTickPipeline(ctx, stages, [outer, inner]);

    expect(calls).toEqual([
      'outer:before:prepare_call',
      'inner:before:prepare_call',
      'stage:prepare_call',
      'inner:after:prepare_call',
      'outer:after:prepare_call',
      'outer:before:execute_llm',
      'inner:before:execute_llm',
      'stage:execute_llm',
      'inner:after:execute_llm',
      'outer:after:execute_llm',
    ]);
  });

  it('stage 抛错时应保持原错误传播语义，并停止后续 stage', async () => {
    const ctx = createPipelineContext();
    const calls: string[] = [];
    const error = new Error('execute_llm failed');

    const stages: TickStage[] = [
      {
        id: 'prepare_call',
        reads: [],
        writes: [],
        async run() {
          calls.push('stage:prepare_call');
        },
      },
      {
        id: 'execute_llm',
        reads: [],
        writes: [],
        async run() {
          calls.push('stage:execute_llm');
          throw error;
        },
      },
      {
        id: 'build_decision',
        reads: [],
        writes: [],
        async run() {
          calls.push('stage:build_decision');
        },
      },
    ];

    const middleware: TickAroundMiddleware = async (_ctx, stage, next) => {
      calls.push(`mw:before:${stage.id}`);
      await next();
      calls.push(`mw:after:${stage.id}`);
    };

    await expect(runTickPipeline(ctx, stages, [middleware])).rejects.toThrow(error);
    expect(calls).toEqual([
      'mw:before:prepare_call',
      'stage:prepare_call',
      'mw:after:prepare_call',
      'mw:before:execute_llm',
      'stage:execute_llm',
    ]);
  });

  it('stage 返回 patch 时应只允许写入声明过的字段并合并到 ctx', async () => {
    const ctx = createPipelineContext();
    const stage: TickStage = {
      id: 'prepare_call',
      reads: [],
      writes: ['modelId'],
      async run() {
        return { modelId: 'patched-model' };
      },
    };

    await runTickPipeline(ctx, [stage]);

    expect(ctx.modelId).toBe('patched-model');
  });

  it('middleware 返回 executorLocalPatch 时应由 runner 合并', async () => {
    const ctx = createPipelineContext();
    ctx.executorLocal = { stepCount: 1 };
    const stage: TickStage = {
      id: 'execute_llm',
      reads: [],
      writes: [],
      async run() {},
    };
    const middleware: TickAroundMiddleware = async (_ctx, _stage, next) => {
      await next();
      return {
        executorLocalPatch: {
          runLockedModelId: 'cloud-fallback-model',
        },
      };
    };

    await runTickPipeline(ctx, [stage], [middleware]);

    expect(ctx.executorLocal).toEqual({ stepCount: 1 });
    expect(ctx.executorLocalPatch).toEqual({
      runLockedModelId: 'cloud-fallback-model',
    });
  });

  it('stage 返回未声明 patch 字段时应 fail-fast', async () => {
    const ctx = createPipelineContext();
    const stage: TickStage = {
      id: 'prepare_call',
      reads: [],
      writes: ['modelId'],
      async run() {
        return { llmOptions: {} };
      },
    };

    await expect(runTickPipeline(ctx, [stage])).rejects.toThrow(
      'TickStage prepare_call returned undeclared patch field: llmOptions',
    );
  });
});
