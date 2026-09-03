/**
 * @file src/core/graph-engine/nodes/__tests__/tool-node.workingHistory.test.ts
 * @description 验证 ToolNode 注入的 conversationView 能看到“本轮 run 内新增的 tool_output”
 *
 * 中文备注（根因级）：
 * - 过去的实现会在第一次 ToolNode.run 时把历史 getter 覆写为一个闭包；
 * - 但该闭包捕获的是“第一次 run 的 local”，而 ToolNode 每次执行后会整体替换 state.local；
 * - 结果：后续工具调用读到的永远是旧 history（常见为空），
 *   直接导致 host citation resolver 无法读取本轮刚产生的来源事实。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolNode } from '../toolNode';
import type { EngineState } from '../../types';
import type { ObservationPreviewPort, ToolRuntimePort } from '../../../tools/ports';
import type { ToolExecutionContext } from '../../../tools/toolExecutionContext';
import { createRuntimeEventAdmissionSink } from './runtimeEventAdmissionFixture';
import { ToolCallIdSchema } from '../../../../contracts';

const { getToolDefinitionMock, executeToolMock } = vi.hoisted(() => ({
  getToolDefinitionMock: vi.fn(),
  executeToolMock: vi.fn(),
}));

describe('ToolNode - working history injection', () => {
  let node: ToolNode;
  let mockToolRuntime: Pick<ToolRuntimePort, 'getToolDefinition' | 'executeTool'>;
  let mockObservationPreview: ObservationPreviewPort;

  beforeEach(() => {
    vi.clearAllMocks();
    mockToolRuntime = {
      getToolDefinition: getToolDefinitionMock,
      executeTool: executeToolMock,
    };
    getToolDefinitionMock.mockReturnValue({
      parameters: { type: 'object', properties: {} },
    });
    const truncateObservationMock = vi.fn<ObservationPreviewPort['truncateObservation']>(
      async ({ text }) => ({ truncated: false, preview: text })
    );
    mockObservationPreview = {
      truncateObservation: truncateObservationMock,
    };
    node = new ToolNode({
      toolRuntime: mockToolRuntime,
      observationPreview: mockObservationPreview,
    });
  });

  it('后续工具调用应能通过 conversationView 读到本轮新增 history', async () => {
    const sharedToolContext: Record<string, unknown> = {};

    executeToolMock.mockImplementation(
      async (toolName: string, _args: Record<string, unknown>, context: ToolExecutionContext) => {
        if (toolName === 'tool_a') {
          // Tool 仍返回 JSON 字符串，ToolNode 解析后只发布 canonical data/observation。
          return {
            success: true,
            result: JSON.stringify({ data: { a: 1 }, observation: 'tool_a completed' }),
          };
        }
        if (toolName === 'tool_b') {
          const history = context.conversationView?.getWorkingHistoryEvents() ?? [];
          return {
            success: true,
            result: JSON.stringify({
              data: { seen_history_len: Array.isArray(history) ? history.length : -1 },
              observation: 'tool_b completed',
            }),
          };
        }
        return { success: false, error: 'unknown tool' };
      }
    );

    const state: EngineState = {
      nodeId: 'tool',
      local: {
        conversationId: 'conv_1',
        turnId: 'turn_1',
        runtimeEventSink: createRuntimeEventAdmissionSink('conv_1', 'run_working_history'),
        toolContext: sharedToolContext,
        pendingToolCalls: [
          {
            id: ToolCallIdSchema.parse('call_a'),
            type: 'function' as const,
            function: { name: 'tool_a', arguments: '{}' },
          },
        ],
      },
    };

    // 1) 执行 tool_a，写入 history
    const r1 = await node.run(state);
    expect(r1.kind).toBe('route');
    // ToolNode 会把 history 写回 state.local.history
    const h1 = (state.local as any)?.history;
    expect(Array.isArray(h1) && h1.length > 0).toBe(true);

    // 2) 再执行 tool_b，它会通过 conversationView 读取本轮 history
    (state.local as any).pendingToolCalls = [
      { id: 'call_b', type: 'function' as const, function: { name: 'tool_b', arguments: '{}' } },
    ];
    const r2 = await node.run(state);
    expect(r2.kind).toBe('route');

    // 从 tool_b 的 tool_output 里取出它观测到的 history 长度
    const h2 = (state.local as any)?.history;
    expect(Array.isArray(h2)).toBe(true);
    const toolBOutputEvt = (h2 as any[]).find(
      e => e && e.type === 'tool_output' && e.tool_name === 'tool_b'
    );
    expect(toolBOutputEvt).toBeTruthy();
    const seenLen = toolBOutputEvt.data?.seen_history_len;
    expect(typeof seenLen).toBe('number');
    // 至少应该能看到 tool_a 产生的事件（action + tool_output 等，长度>0 即可证明不是“旧闭包空历史”）
    expect(seenLen).toBeGreaterThan(0);
  });
});
