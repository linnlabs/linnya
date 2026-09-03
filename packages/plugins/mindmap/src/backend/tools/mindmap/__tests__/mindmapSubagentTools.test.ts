/**
 * @file mindmapSubagentTools.test.ts
 * @description MindMap 子 agent runner 工具契约测试
 *
 * 中文说明：
 * - 只测“固定 promptKey / subrun_trace 绑定 / 入参拼装”这类工具契约；
 * - 不启动真实 LLM / GraphExecutor（通过 mock subagent runner）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MindmapPromptKeys } from '@plugin/mindmap/shared';
import { createToolContextFixture } from '@linnlabs/linnkit/testkit';
import {
  MindMapSubrunDecomposeTool,
  MindMapSubrunProposeTool,
  MindMapSubrunValidateTool,
  MindMapSubrunParallelTool,
} from '../mindmapSubagentTools';

// ----------------------------
// mocks
// ----------------------------

const { runRegisteredSubagentMock, runRegisteredSubagentsInParallelMock, createSubRunTracePublisherMock } = vi.hoisted(() => ({
  runRegisteredSubagentMock: vi.fn(),
  runRegisteredSubagentsInParallelMock: vi.fn(),
  createSubRunTracePublisherMock: vi.fn(),
}));

vi.mock('@plugin/backend/toolRuntime', () => {
  class MockBaseTool {}
  return {
    BaseTool: MockBaseTool,
    runRegisteredSubagent: runRegisteredSubagentMock,
    runRegisteredSubagentsInParallel: runRegisteredSubagentsInParallelMock,
  };
});

describe('MindMap 子 agent runner tools', () => {
  beforeEach(() => {
    runRegisteredSubagentMock.mockReset();
    runRegisteredSubagentsInParallelMock.mockReset();
    createSubRunTracePublisherMock.mockReset();
    runRegisteredSubagentMock.mockResolvedValue({ success: true, finalAnswer: 'ok', subrunId: 'subrun_1' });
    runRegisteredSubagentsInParallelMock.mockResolvedValue([
      { success: true, finalAnswer: 'ok', subrunId: 'subrun_1' },
      { success: true, finalAnswer: 'ok', subrunId: 'subrun_2' },
      { success: true, finalAnswer: 'ok', subrunId: 'subrun_3' },
    ]);
    createSubRunTracePublisherMock.mockReturnValue({ publish: vi.fn() });
  });

  it('mindmap_subrun_decompose 必须使用固定 promptKey，并发布 subrun_trace（metadata 含 document/target）', async () => {
    const tool = new MindMapSubrunDecomposeTool();

    const output = await tool.run(
      {
        document_id: 'doc_1',
        target_node_ref: 'abc123',
        description: '拆解子问题',
        prompt: '请对该问题进行拆解',
      },
      createMindmapToolContext({
        parentToolCallId: 'ptc_1',
        createSubRunTracePublisher: createSubRunTracePublisherMock,
        abortSignal: new AbortController().signal,
      }) as unknown as Parameters<typeof tool.run>[1]
    );

    expect(typeof output).toBe('string');
    expect(JSON.parse(output)).toMatchObject({
      data: {
        subrun_id: 'subrun_1',
        final_answer: 'ok',
      },
    });
    expect(runRegisteredSubagentMock).toHaveBeenCalledTimes(1);

    const callArg = runRegisteredSubagentMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg['userMessage']).toContain('document_id: doc_1');
    expect(callArg['userMessage']).toContain('target_node: [#abc123]');
    expect(callArg['promptKey']).toBe(MindmapPromptKeys.MINDMAP_DECOMPOSE_QUESTION);
    expect(callArg['maxSteps']).toBe(60);
    expect(callArg['subrunSource']).toBe('mindmap_subrun_decompose');
    expect(isRecord(callArg['subrunMetadata'])).toBe(true);
    const md = callArg['subrunMetadata'] as Record<string, unknown>;
    expect(md['document_id']).toBe('doc_1');
    expect(md['target_node_ref']).toBe('#abc123');
    expect(md['prompt_key']).toBe(MindmapPromptKeys.MINDMAP_DECOMPOSE_QUESTION);
    expect(md['runner_tool']).toBe('mindmap_subrun_decompose');
  });

  it('mindmap_subrun_propose 必须使用固定 promptKey', async () => {
    const tool = new MindMapSubrunProposeTool();

    await tool.run(
      {
        document_id: 'doc_2',
        target_node_ref: '#k9Q2x7',
        description: '提出假设',
        prompt: '请提出若干可验证假设',
      },
      createMindmapToolContext({
        abortSignal: new AbortController().signal,
      }) as unknown as Parameters<typeof tool.run>[1]
    );

    const callArg = runRegisteredSubagentMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg['promptKey']).toBe(MindmapPromptKeys.MINDMAP_PROPOSE_HYPOTHESIS);
  });

  it('mindmap_subrun_validate 必须使用固定 promptKey，并允许使用 target_node_id 作为 anchor', async () => {
    const tool = new MindMapSubrunValidateTool();

    await tool.run(
      {
        document_id: 'doc_3',
        target_node_id: 'node-uuid-1',
        description: '验证假设',
        prompt: '请验证该假设并挂证据',
      },
      createMindmapToolContext({
        abortSignal: new AbortController().signal,
      }) as unknown as Parameters<typeof tool.run>[1]
    );

    const callArg = runRegisteredSubagentMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg['userMessage']).toContain('document_id: doc_3');
    expect(callArg['userMessage']).toContain('target_node: nodeId=node-uuid-1');
    expect(callArg['promptKey']).toBe(MindmapPromptKeys.MINDMAP_VALIDATE_HYPOTHESIS);
    expect(callArg['maxSteps']).toBe(80);
  });

  it('mindmap_subrun_parallel 应并行启动多个子 agent，并为每个任务使用固定 promptKey', async () => {
    const tool = new MindMapSubrunParallelTool();

    const output = await tool.run(
      {
        document_id: 'doc_p',
        max_concurrency: 3,
        subruns: [
          {
            kind: 'decompose',
            target_node_ref: 'n1',
            description: '拆解 1',
            prompt: 'p1',
          },
          {
            kind: 'propose',
            target_node_ref: '#n2',
            description: '提出 2',
            prompt: 'p2',
          },
          {
            kind: 'validate',
            target_node_id: 'node-uuid-3',
            description: '验证 3',
            prompt: 'p3',
          },
        ],
      },
      createMindmapToolContext({
        parentToolCallId: 'ptc_parallel',
        createSubRunTracePublisher: createSubRunTracePublisherMock,
        abortSignal: new AbortController().signal,
      }) as unknown as Parameters<typeof tool.run>[1]
    );

    expect(typeof output).toBe('string');
    expect(JSON.parse(output)).toMatchObject({
      data: {
        results: [
          { subrun_id: 'subrun_1', final_answer: 'ok' },
          { subrun_id: 'subrun_2', final_answer: 'ok' },
          { subrun_id: 'subrun_3', final_answer: 'ok' },
        ],
      },
    });
    expect(runRegisteredSubagentsInParallelMock).toHaveBeenCalledTimes(1);

    const callArg = runRegisteredSubagentsInParallelMock.mock.calls[0]?.[0] as Record<string, unknown>;
    const subruns = (callArg['subruns'] as Array<Record<string, unknown>>) ?? [];
    expect(subruns).toHaveLength(3);
    expect(subruns[0]?.['promptKey']).toBe(MindmapPromptKeys.MINDMAP_DECOMPOSE_QUESTION);
    expect(subruns[1]?.['promptKey']).toBe(MindmapPromptKeys.MINDMAP_PROPOSE_HYPOTHESIS);
    expect(subruns[2]?.['promptKey']).toBe(MindmapPromptKeys.MINDMAP_VALIDATE_HYPOTHESIS);
    for (const subrun of subruns) {
      const md = subrun['subrunMetadata'] as Record<string, unknown>;
      expect(md['document_id']).toBe('doc_p');
      expect(md['runner_tool']).toBe('mindmap_subrun_parallel');
    }
  });

  it('mindmap_subrun_parallel 在 subruns>max_concurrency 时应分批执行，但保持结果顺序与数量', async () => {
    const tool = new MindMapSubrunParallelTool();

    runRegisteredSubagentsInParallelMock.mockResolvedValue([
      { success: true, finalAnswer: 'ok', subrunId: 'subrun_1' },
      { success: true, finalAnswer: 'ok', subrunId: 'subrun_2' },
      { success: true, finalAnswer: 'ok', subrunId: 'subrun_3' },
      { success: true, finalAnswer: 'ok', subrunId: 'subrun_4' },
      { success: true, finalAnswer: 'ok', subrunId: 'subrun_5' },
      { success: true, finalAnswer: 'ok', subrunId: 'subrun_6' },
      { success: true, finalAnswer: 'ok', subrunId: 'subrun_7' },
    ]);

    const output = await tool.run(
      {
        document_id: 'doc_p2',
        max_concurrency: 3,
        subruns: [
          { kind: 'decompose', target_node_ref: 'a1', description: 't1', prompt: 'p1' },
          { kind: 'propose', target_node_ref: 'a2', description: 't2', prompt: 'p2' },
          { kind: 'validate', target_node_ref: 'a3', description: 't3', prompt: 'p3' },
          { kind: 'decompose', target_node_ref: 'a4', description: 't4', prompt: 'p4' },
          { kind: 'propose', target_node_ref: 'a5', description: 't5', prompt: 'p5' },
          { kind: 'validate', target_node_ref: 'a6', description: 't6', prompt: 'p6' },
          { kind: 'decompose', target_node_ref: 'a7', description: 't7', prompt: 'p7' },
        ],
      },
      createMindmapToolContext({
        parentToolCallId: 'ptc_parallel_2',
        createSubRunTracePublisher: createSubRunTracePublisherMock,
        abortSignal: new AbortController().signal,
      }) as unknown as Parameters<typeof tool.run>[1]
    );

    expect(typeof output).toBe('string');
    expect(runRegisteredSubagentsInParallelMock).toHaveBeenCalledTimes(1);

    const parsed = JSON.parse(output) as { data?: { results?: Array<{ kind?: string; description?: string }> } };
    const results = parsed.data?.results ?? [];
    expect(results).toHaveLength(7);
    expect(results.map((r) => r.description)).toEqual(['t1', 't2', 't3', 't4', 't5', 't6', 't7']);
    expect(results.map((r) => r.kind)).toEqual(['decompose', 'propose', 'validate', 'decompose', 'propose', 'validate', 'decompose']);
  });

  it('单个和并行子过程都应保留 cancelled，且不把取消计为失败', async () => {
    runRegisteredSubagentMock.mockResolvedValueOnce({
      success: false,
      cancelled: true,
      finalAnswer: '',
      error: 'user cancelled',
      subrunId: 'subrun_cancelled',
    });
    const singleTool = new MindMapSubrunDecomposeTool();
    const singleOutput = await singleTool.run(
      {
        document_id: 'doc_cancelled',
        target_node_ref: 'n1',
        description: '取消拆解',
        prompt: 'p1',
      },
      createMindmapToolContext(),
    );
    const single = JSON.parse(singleOutput) as { data: Record<string, unknown>; observation: string };
    expect(single.data.cancelled).toBe(true);
    expect(single.observation).toBe('子过程已取消。');
    expect(singleTool.getExecutionSummary(singleOutput)).toBe('取消拆解：已取消。');

    runRegisteredSubagentsInParallelMock.mockResolvedValueOnce([
      { success: true, finalAnswer: 'ok', subrunId: 'subrun_1' },
      { success: false, cancelled: true, finalAnswer: '', subrunId: 'subrun_2' },
      { success: false, finalAnswer: '', error: 'failed', subrunId: 'subrun_3' },
    ]);
    const parallelTool = new MindMapSubrunParallelTool();
    const parallelOutput = await parallelTool.run(
      {
        document_id: 'doc_parallel_cancelled',
        subruns: [
          { kind: 'decompose', target_node_ref: 'n1', description: 't1', prompt: 'p1' },
          { kind: 'propose', target_node_ref: 'n2', description: 't2', prompt: 'p2' },
          { kind: 'validate', target_node_ref: 'n3', description: 't3', prompt: 'p3' },
        ],
      },
      createMindmapToolContext(),
    );
    const parallel = JSON.parse(parallelOutput) as {
      data: { results: Array<Record<string, unknown>> };
      observation: string;
    };
    expect(parallel.data.results[1]?.cancelled).toBe(true);
    expect(parallel.observation).toBe('并行子过程结束：完成 1/3；取消 1；失败 1');
  });
});

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function createMindmapToolContext(
  patch: Record<string, unknown> = {},
): Parameters<MindMapSubrunDecomposeTool['run']>[1] {
  return createToolContextFixture({
    historyEvents: [],
    patch,
  }) as Parameters<MindMapSubrunDecomposeTool['run']>[1];
}
