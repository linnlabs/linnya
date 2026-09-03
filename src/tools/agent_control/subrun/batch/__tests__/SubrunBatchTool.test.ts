import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAX_STEPS } from 'linnkit/contracts';
import { createToolContextFixture } from 'linnkit/testkit';
import { ALL_AGENT_DEFINITIONS_FOR_TESTS } from 'src/app-hosts/linnya/agent-registry/agents';
import { legacyBuiltinToolClasses } from 'src/app-hosts/linnya/adapters/tools/legacyToolClasses';
import {
  SUBRUN_BATCH_TOOL_NAME,
  SubrunBatchTool,
} from '../SubrunBatchTool';

const { runRegisteredSubagentsInParallelMock } = vi.hoisted(() => ({
  runRegisteredSubagentsInParallelMock: vi.fn(),
}));

vi.mock('src/tools/agent_control/subrun/shared', () => ({
  runRegisteredSubagentsInParallel: runRegisteredSubagentsInParallelMock,
}));

const validArgs = {
  worker_prompt_key: 'table_ai_fill',
  subruns: [
    {
      unit_id: 'row-1',
      subrun_id: 'subrun-row-1',
      description: '填充第 1 行',
      prompt: '根据 A 列内容填写 B 列。',
    },
    {
      unit_id: 'row-2',
      subrun_id: 'subrun-row-2',
      description: '填充第 2 行',
      prompt: '根据 A 列内容填写 B 列。',
    },
  ],
};

describe('SubrunBatchTool', () => {
  beforeEach(() => {
    runRegisteredSubagentsInParallelMock.mockReset();
  });

  it('按稳定 subrun 身份受控并发 child runs，并透传 worker 与父模型', async () => {
    runRegisteredSubagentsInParallelMock.mockResolvedValue([
      { subrunId: 'subrun-row-1', success: true, finalAnswer: '第一行完成' },
      { subrunId: 'subrun-row-2', success: false, finalAnswer: '', error: '第二行失败' },
    ]);

    const output = await new SubrunBatchTool().run(validArgs, createToolContextFixture({
      patch: {
        parentToolCallId: 'parent-tool-call',
        modelId: 'user-selected-model',
      },
    }));

    expect(runRegisteredSubagentsInParallelMock).toHaveBeenCalledOnce();
    expect(runRegisteredSubagentsInParallelMock).toHaveBeenCalledWith(expect.objectContaining({
      maxConcurrency: 3,
      subruns: [
        expect.objectContaining({
          subrunId: 'subrun-row-1',
          promptKey: 'table_ai_fill',
          modelId: 'user-selected-model',
          maxSteps: DEFAULT_MAX_STEPS,
          inheritTurns: 0,
          subrunSource: SUBRUN_BATCH_TOOL_NAME,
        }),
        expect.objectContaining({
          subrunId: 'subrun-row-2',
          promptKey: 'table_ai_fill',
          modelId: 'user-selected-model',
        }),
      ],
    }));

    const result: unknown = JSON.parse(output);
    expect(result).toMatchObject({
      data: {
        status: 'partial',
        total: 2,
        succeeded: 1,
        failed: 1,
        cancelled: 0,
        subrun_ids: ['subrun-row-1', 'subrun-row-2'],
      },
    });
    expect(result).not.toHaveProperty('control');
  });

  it('拒绝不完整或身份重复的系统输入，不启动 child run', async () => {
    const tool = new SubrunBatchTool();
    const context = createToolContextFixture({
      patch: { parentToolCallId: 'parent-tool-call', modelId: 'model' },
    });

    await expect(tool.run({ subruns: validArgs.subruns }, context)).rejects.toThrow('worker_prompt_key');
    await expect(tool.run({
      ...validArgs,
      subruns: [validArgs.subruns[0], { ...validArgs.subruns[1], unit_id: 'row-1' }],
    }, context)).rejects.toThrow('unit_id must be unique');
    expect(runRegisteredSubagentsInParallelMock).not.toHaveBeenCalled();
  });

  it('缺少 graph 注入上下文时直接失败，且执行异常不伪装成业务结果', async () => {
    const tool = new SubrunBatchTool();
    await expect(tool.run(validArgs, createToolContextFixture({
      patch: { modelId: 'model' },
    }))).rejects.toThrow('parentToolCallId is required');

    runRegisteredSubagentsInParallelMock.mockRejectedValue(new Error('child runtime unavailable'));
    await expect(tool.run(validArgs, createToolContextFixture({
      patch: { parentToolCallId: 'parent-tool-call', modelId: 'model' },
    }))).rejects.toThrow('child runtime unavailable');
  });
});

describe('subrun_batch 注册边界', () => {
  it('注册到 host 工具全集，但不暴露给任何 agent', () => {
    expect(legacyBuiltinToolClasses).toContain(SubrunBatchTool);

    for (const definition of ALL_AGENT_DEFINITIONS_FOR_TESTS) {
      const availableTools = definition.config?.availableTools;
      if (definition.config?.enableTools === true) {
        expect(Array.isArray(availableTools), `${definition.id} 必须使用显式工具清单`).toBe(true);
      }
      expect(availableTools ?? []).not.toContain(SUBRUN_BATCH_TOOL_NAME);
    }
  });
});
