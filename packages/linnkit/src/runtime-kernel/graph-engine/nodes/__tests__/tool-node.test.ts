/**
 * @file src/core/graph-engine/nodes/__tests__/tool-node.test.ts
 * @description ToolNode 单元测试
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolNode } from '../toolNode';
import { EngineState } from '../../types';
import type { AuditPort } from '../../../../ports';
import type { ObservationPreviewPort, ToolRuntimePort } from '../../../tools/ports';
import {
  createToolOutputEvent,
  type RuntimeEvent,
  RunIdSchema,
  ToolCallIdSchema,
} from '../../../../contracts';
import { createRuntimeEventAdmissionSink } from './runtimeEventAdmissionFixture';

const { getToolDefinitionMock, executeToolMock } = vi.hoisted(() => ({
  getToolDefinitionMock: vi.fn(),
  executeToolMock: vi.fn(),
}));
const EXPECTED_IDEMPOTENCY_KEY = ['b80e1053e71d71fc', 'f23f698531db6960'].join('');

function structuredToolResult(observation: string): string {
  return JSON.stringify({ data: {}, observation });
}

describe('ToolNode - 单元测试', () => {
  let toolNode: ToolNode;
  let mockAuditPort: AuditPort & { emit: ReturnType<typeof vi.fn> };
  let mockToolRuntime: Pick<ToolRuntimePort, 'getToolDefinition' | 'executeTool'>;
  let mockObservationPreview: ObservationPreviewPort;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditPort = { emit: vi.fn() };
    mockToolRuntime = {
      getToolDefinition: getToolDefinitionMock,
      executeTool: executeToolMock,
    };
    const truncateObservationMock = vi.fn<ObservationPreviewPort['truncateObservation']>(
      async ({ text }) => ({ truncated: false, preview: text })
    );
    mockObservationPreview = {
      truncateObservation: truncateObservationMock,
    };
    toolNode = new ToolNode({
      toolRuntime: mockToolRuntime,
      observationPreview: mockObservationPreview,
      auditPort: mockAuditPort,
    });
    getToolDefinitionMock.mockReturnValue({
      parameters: { type: 'object', properties: {} },
    });
  });

  describe('1. 基础功能', () => {
    it('应该有正确的节点 ID', () => {
      expect(toolNode.id).toBe('tool');
    });

    it('应该在没有 pendingToolCalls 时 yield', async () => {
      const state: EngineState = {
        nodeId: 'tool',
        local: {
          conversationId: 'conv_1',
          turnId: 'turn_1',
          runtimeEventSink: createRuntimeEventAdmissionSink('conv_1', 'run_basic'),
        },
      };

      const result = await toolNode.run(state);

      expect(result.kind).toBe('yield');
      expect(result.events).toEqual([]);
    });
  });

  describe('2. 工具执行成功', () => {
    it('应该路由回 llm 节点', async () => {
      executeToolMock.mockResolvedValue({
        success: true,
        result: structuredToolResult('Tool result'),
      });

      const state: EngineState = {
        nodeId: 'tool',
        local: {
          conversationId: 'conv_1',
          turnId: 'turn_1',
          runtimeEventSink: createRuntimeEventAdmissionSink('conv_1', 'run_success'),
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('call_1'),
              type: 'function' as const,
              function: { name: 'search', arguments: '{"query":"test"}' },
            },
          ],
          toolContext: {},
        },
      };

      const result = await toolNode.run(state);

      expect(result.kind).toBe('route');
      expect(result.nextNodeId).toBe('llm');
    });

    it('应该从 executorLocal 读取 observation governance 配置', async () => {
      executeToolMock.mockResolvedValue({
        success: true,
        result: JSON.stringify({
          observation: 'very long output',
          data: {},
        }),
      });

      const state: EngineState = {
        nodeId: 'tool',
        local: {
          conversationId: 'conv_1',
          turnId: 'turn_1',
          runtimeEventSink: createRuntimeEventAdmissionSink('conv_1', 'run_governance'),
          executorLocal: {
            stepCount: 0,
            toolObservationPolicy: {
              maxChars: 1024,
              maxLines: 64,
            },
          },
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('call_1'),
              type: 'function' as const,
              function: { name: 'search', arguments: '{"query":"test"}' },
            },
          ],
          toolContext: {},
        },
      };

      await toolNode.run(state);

      expect(mockObservationPreview.truncateObservation).toHaveBeenCalledWith(
        expect.objectContaining({
          maxChars: 1024,
          maxLines: 64,
        })
      );
    });

    it('不应覆盖已注入的 toolContext.conversationId（用于 conversation-root artifacts）', async () => {
      let capturedContext: any = null;
      executeToolMock.mockImplementation(
        async (_toolName: string, _args: unknown, ctx: unknown) => {
          capturedContext = ctx;
          return { success: true, result: structuredToolResult('OK') };
        }
      );

      const state: EngineState = {
        nodeId: 'tool',
        local: {
          // 模拟 internal 子 run：local.conversationId 是 internal_*
          conversationId: 'internal_1',
          turnId: 'turn_1',
          runtimeEventSink: createRuntimeEventAdmissionSink('internal_1', 'run_child'),
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('call_1'),
              type: 'function' as const,
              function: { name: 'search', arguments: '{"query":"test"}' },
            },
          ],
          // ✅ 上游（父会话）已经注入真实 conv-*：必须保留
          toolContext: { conversationId: 'conv_root_1' },
        },
      };

      await toolNode.run(state);

      expect(capturedContext).toBeTruthy();
      expect(capturedContext.conversationId).toBe('conv_root_1');
    });

    it('requireUser 工具不应预写 tool_output，而应直接进入 wait_user', async () => {
      executeToolMock.mockResolvedValue({
        success: true,
        result: JSON.stringify({
          data: {
            title: 'Deck Plan',
            pageCount: 2,
            pages: [
              { slideNumber: 1, title: 'Intro', content: '介绍背景' },
              { slideNumber: 2, title: 'Plan', content: '说明方案' },
            ],
          },
          observation: 'PPT 计划已生成。',
          control: {
            requireUser: true,
            resumeStrategy: 'continue',
          },
        }),
      });

      const state: EngineState = {
        nodeId: 'tool',
        local: {
          conversationId: 'conv_1',
          turnId: 'turn_1',
          runtimeEventSink: createRuntimeEventAdmissionSink('conv_1', 'run_wait_user'),
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('call_ppt_plan_1'),
              type: 'function' as const,
              function: { name: 'ppt_plan', arguments: '{"title":"Deck Plan"}' },
            },
          ],
          toolContext: {},
        },
      };

      const result = await toolNode.run(state);

      expect(result.kind).toBe('route');
      expect(result.nextNodeId).toBe('wait_user');

      const runtimeEvents = result.events ?? [];
      expect(runtimeEvents.filter(event => event.type === 'tool_process')).toHaveLength(1);
      expect(runtimeEvents.find(event => event.type === 'tool_output')).toBeUndefined();
    });

    it('执行期 observation 截断后应把字符计量写入 tool_output metadata', async () => {
      executeToolMock.mockResolvedValue({
        success: true,
        result: JSON.stringify({
          observation: 'line 1\nline 2\nline 3',
          data: {},
        }),
        durationMs: 5,
      });
      mockObservationPreview.truncateObservation = vi.fn(async () => ({
        truncated: true,
        preview: 'line 1',
        blob_id: 'blob_1',
        originalChars: 20,
        previewChars: 6,
        originalLines: 3,
        previewLines: 1,
      }));

      const state: EngineState = {
        nodeId: 'tool',
        local: {
          conversationId: 'conv_1',
          turnId: 'turn_1',
          runtimeEventSink: createRuntimeEventAdmissionSink('conv_1', 'run_truncation'),
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('call_1'),
              type: 'function' as const,
              function: { name: 'search', arguments: '{"query":"test"}' },
            },
          ],
          toolContext: {},
        },
      };

      const result = await toolNode.run(state);
      const runtimeEvents = result.events ?? [];
      const toolOutput = runtimeEvents.find(event => event.type === 'tool_output');

      expect(toolOutput?.metadata?.observationTruncation).toEqual({
        blobId: 'blob_1',
        originalChars: 20,
        previewChars: 6,
        originalLines: 3,
        previewLines: 1,
      });
      expect(
        state.local?.history?.find(event => event.type === 'tool_output')?.metadata
          ?.observationTruncation
      ).toEqual({
        blobId: 'blob_1',
        originalChars: 20,
        previewChars: 6,
        originalLines: 3,
        previewLines: 1,
      });
    });

    it('幂等工具命中历史成功输出时不应再次执行工具', async () => {
      getToolDefinitionMock.mockReturnValue({
        parameters: { type: 'object', properties: {} },
        idempotency: { scope: 'conversation' },
      });

      const state: EngineState = {
        nodeId: 'tool',
        local: {
          conversationId: 'conv_1',
          turnId: 'turn_2',
          runtimeEventSink: createRuntimeEventAdmissionSink('conv_1', 'run_cache_hit'),
          history: [
            createToolOutputEvent(
              'cached-output',
              'conv_1',
              'turn_1',
              'search',
              'call_old',
              { status: 'success', observation: 'cached result', data: {} },
              {
                metadata: {
                  idempotency: {
                    key: EXPECTED_IDEMPOTENCY_KEY,
                  },
                },
              }
            ),
          ],
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('call_new'),
              type: 'function' as const,
              function: { name: 'search', arguments: '{"query":"test"}' },
            },
          ],
          toolContext: {},
        },
      };

      const result = await toolNode.run(state);
      const toolOutput = result.events?.find(event => event.type === 'tool_output');

      expect(executeToolMock).not.toHaveBeenCalled();
      expect(toolOutput).toMatchObject({
        type: 'tool_output',
        observation: 'cached result',
        data: {},
        ephemeral: true,
        metadata: {
          idempotency: {
            key: EXPECTED_IDEMPOTENCY_KEY,
            cache_hit: true,
          },
        },
      });
    });

    it('同进程相同幂等 key 并发执行时只应调用一次底层工具', async () => {
      getToolDefinitionMock.mockReturnValue({
        parameters: { type: 'object', properties: {} },
        idempotency: { scope: 'conversation' },
      });
      let releaseTool!: () => void;
      const toolCanFinish = new Promise<void>(resolve => {
        releaseTool = resolve;
      });
      executeToolMock.mockImplementation(async () => {
        await toolCanFinish;
        return {
          success: true,
          result: structuredToolResult('fresh result'),
          durationMs: 12,
        };
      });

      const createState = (turnId: string): EngineState => ({
        nodeId: 'tool',
        local: {
          conversationId: 'conv_1',
          turnId,
          runtimeEventSink: createRuntimeEventAdmissionSink('conv_1', `run_${turnId}`),
          history: [],
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse(`call_${turnId}`),
              type: 'function' as const,
              function: { name: 'search', arguments: '{"query":"test"}' },
            },
          ],
          toolContext: {},
        },
      });

      const firstRun = toolNode.run(createState('turn_a'));
      const secondRun = toolNode.run(createState('turn_b'));
      await new Promise<void>(resolve => {
        setTimeout(resolve, 0);
      });
      releaseTool();

      const [firstResult, secondResult] = await Promise.all([firstRun, secondRun]);
      const firstOutput = firstResult.events?.find(event => event.type === 'tool_output');
      const secondOutput = secondResult.events?.find(event => event.type === 'tool_output');

      expect(executeToolMock).toHaveBeenCalledTimes(1);
      expect(firstOutput).toMatchObject({
        observation: 'fresh result',
        data: {},
        metadata: {
          idempotency: {
            key: EXPECTED_IDEMPOTENCY_KEY,
            cache_hit: false,
          },
        },
      });
      expect(secondOutput).toMatchObject({
        observation: 'fresh result',
        data: {},
        ephemeral: true,
        metadata: {
          idempotency: {
            key: EXPECTED_IDEMPOTENCY_KEY,
            cache_hit: true,
          },
        },
      });
    });
  });

  describe('3. 工具执行失败', () => {
    it('工具成功返回缺少 observation 时应转为合同错误，且不累计 Agent 协议错误', async () => {
      executeToolMock.mockResolvedValue({
        success: true,
        result: JSON.stringify({ data: { ok: true } }),
        durationMs: 2,
      });
      const state: EngineState = {
        nodeId: 'tool',
        local: {
          conversationId: 'conv_1',
          turnId: 'turn_1',
          runtimeEventSink: createRuntimeEventAdmissionSink('conv_1', 'run_contract_error'),
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('call_contract'),
              type: 'function' as const,
              function: { name: 'broken_tool', arguments: '{}' },
            },
          ],
          toolContext: {},
        },
      };

      const result = await toolNode.run(state);
      const output = result.events?.find(event => event.type === 'tool_output');

      expect(output).toMatchObject({
        status: 'error',
        error: expect.stringContaining('TOOL_RESULT_CONTRACT_VIOLATION'),
        observation: expect.stringContaining('TOOL_RESULT_CONTRACT_VIOLATION'),
      });
      expect(state.local?._consecutiveToolProtocolErrors).toBeUndefined();
    });

    it('应该处理工具执行错误', async () => {
      executeToolMock.mockResolvedValue({
        success: false,
        error: 'Tool failed',
        errorKind: 'execution',
      });

      const state: EngineState = {
        nodeId: 'tool',
        local: {
          conversationId: 'conv_1',
          turnId: 'turn_1',
          runtimeEventSink: createRuntimeEventAdmissionSink('conv_1', 'run_execution_error'),
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('call_1'),
              type: 'function' as const,
              function: { name: 'search', arguments: '{}' },
            },
          ],
          toolContext: {},
        },
      };

      const result = await toolNode.run(state);

      expect(result.kind).toBe('route');
      expect(result.nextNodeId).toBe('llm');
      expect(result.events).toBeDefined();
    });

    it('批量工具调用中某个工具失败时，也应继续消费剩余工具调用', async () => {
      executeToolMock
        .mockResolvedValueOnce({
          success: false,
          error: 'Root path is a directory',
          errorKind: 'execution',
        })
        .mockResolvedValueOnce({
          success: true,
          result: structuredToolResult('read result'),
        });

      const secondCall = {
        id: ToolCallIdSchema.parse('call_2'),
        type: 'function' as const,
        function: { name: 'read_file', arguments: '{"path":"/"}' },
      };
      const state: EngineState = {
        nodeId: 'tool',
        local: {
          conversationId: 'conv_1',
          turnId: 'turn_1',
          runtimeEventSink: createRuntimeEventAdmissionSink('conv_1', 'run_batch_error'),
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('call_1'),
              type: 'function' as const,
              function: { name: 'list_files', arguments: '{"path":"/"}' },
            },
            secondCall,
          ],
          toolContext: {},
        },
      };

      const result = await toolNode.run(state);

      expect(result.kind).toBe('route');
      expect(result.nextNodeId).toBe('llm');
      expect(state.local?.pendingToolCalls).toEqual([]);
      expect(executeToolMock).toHaveBeenCalledTimes(2);
      expect(state.local?.history?.filter(event => event.type === 'tool_output')).toHaveLength(2);
    });

    it('批量工具调用中连续 protocol error 达到熔断阈值时，应先消费剩余工具调用', async () => {
      executeToolMock.mockResolvedValue({
        success: true,
        result: structuredToolResult('OK'),
      });

      const state: EngineState = {
        nodeId: 'tool',
        local: {
          conversationId: 'conv_1',
          turnId: 'turn_1',
          runtimeEventSink: createRuntimeEventAdmissionSink('conv_1', 'run_batch_protocol'),
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('call_bad_1'),
              type: 'function' as const,
              function: { name: 'bad_tool_1', arguments: 'invalid json' },
            },
            {
              id: ToolCallIdSchema.parse('call_bad_2'),
              type: 'function' as const,
              function: { name: 'bad_tool_2', arguments: 'invalid json' },
            },
            {
              id: ToolCallIdSchema.parse('call_bad_3'),
              type: 'function' as const,
              function: { name: 'bad_tool_3', arguments: 'invalid json' },
            },
            {
              id: ToolCallIdSchema.parse('call_bad_4'),
              type: 'function' as const,
              function: { name: 'bad_tool_4', arguments: 'invalid json' },
            },
            {
              id: ToolCallIdSchema.parse('call_ok_5'),
              type: 'function' as const,
              function: { name: 'ok_tool', arguments: '{}' },
            },
          ],
          toolContext: {},
        },
      };

      const result = await toolNode.run(state);

      expect(result.kind).toBe('route');
      expect(result.nextNodeId).toBe('llm');
      expect(state.local?.pendingToolCalls).toEqual([]);
      expect(executeToolMock).toHaveBeenCalledTimes(1);
      expect(
        mockAuditPort.emit.mock.calls.filter(([envelope]) => {
          return envelope.action === 'tool.protocol_error';
        })
      ).toHaveLength(4);
      expect(state.local?.history?.filter(event => event.type === 'tool_output')).toHaveLength(5);
      expect('_consecutiveToolProtocolErrors' in (state.local ?? {})).toBe(false);
    });

    it('第一次 protocol error 应允许回到 llm 自修正，并记录连续次数', async () => {
      executeToolMock.mockResolvedValue({
        success: false,
        error: 'Missing required parameter: name',
        errorKind: 'protocol',
      });

      const state: EngineState = {
        nodeId: 'tool',
        local: {
          conversationId: 'conv_1',
          turnId: 'turn_1',
          runtimeEventSink: createRuntimeEventAdmissionSink('conv_1', 'run_protocol_first'),
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('call_1'),
              type: 'function' as const,
              function: { name: 'document_create', arguments: '{}' },
            },
          ],
          toolContext: {},
        },
      };

      const result = await toolNode.run(state);

      expect(result.kind).toBe('route');
      expect(result.nextNodeId).toBe('llm');
      expect(state.local?._consecutiveToolProtocolErrors).toBe(1);
      expect(mockAuditPort.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tool.protocol_error',
          decision: expect.objectContaining({
            outcome: 'recorded',
            reason: 'Missing required parameter: name',
            metadata: {
              rawArguments: '{}',
              parsedArguments: {},
            },
          }),
          scope: expect.objectContaining({
            toolName: 'document_create',
            toolCallId: 'call_1',
          }),
        })
      );
    });

    it('连续第三次 protocol error 仍应允许回到 llm，保留更多自修正空间', async () => {
      executeToolMock.mockResolvedValue({
        success: false,
        error: 'Missing required parameter: name',
        errorKind: 'protocol',
      });

      const state: EngineState = {
        nodeId: 'tool',
        local: {
          conversationId: 'conv_1',
          turnId: 'turn_1',
          runtimeEventSink: createRuntimeEventAdmissionSink('conv_1', 'run_protocol_third'),
          _consecutiveToolProtocolErrors: 2,
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('call_3'),
              type: 'function' as const,
              function: { name: 'document_create', arguments: '{}' },
            },
          ],
          toolContext: {},
        },
      };

      const result = await toolNode.run(state);

      expect(result.kind).toBe('route');
      expect(result.nextNodeId).toBe('llm');
      expect(state.local?._consecutiveToolProtocolErrors).toBe(3);
    });

    it('连续第四次 protocol error 应直接熔断，而不是继续回 llm', async () => {
      executeToolMock.mockResolvedValue({
        success: false,
        error: 'Missing required parameter: name',
        errorKind: 'protocol',
      });

      const state: EngineState = {
        nodeId: 'tool',
        local: {
          conversationId: 'conv_1',
          turnId: 'turn_1',
          runtimeEventSink: createRuntimeEventAdmissionSink('conv_1', 'run_protocol_fourth'),
          _consecutiveToolProtocolErrors: 3,
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('call_4'),
              type: 'function' as const,
              function: { name: 'document_create', arguments: '{}' },
            },
          ],
          toolContext: {},
        },
      };

      await expect(toolNode.run(state)).rejects.toMatchObject({
        name: 'ToolProtocolFuseError',
      });
    });

    it('应该处理 JSON 解析错误', async () => {
      const state: EngineState = {
        nodeId: 'tool',
        local: {
          conversationId: 'conv_1',
          turnId: 'turn_1',
          runtimeEventSink: createRuntimeEventAdmissionSink('conv_1', 'run_json_error'),
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('call_1'),
              type: 'function' as const,
              function: { name: 'search', arguments: 'invalid json' },
            },
          ],
          toolContext: {},
        },
      };

      const result = await toolNode.run(state);

      expect(result.kind).toBe('route');
      expect(result.nextNodeId).toBe('llm');
      expect(executeToolMock).not.toHaveBeenCalled();
      expect(state.local?._consecutiveToolProtocolErrors).toBe(1);
      expect(mockAuditPort.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tool.protocol_error',
          decision: expect.objectContaining({
            outcome: 'recorded',
            reason: expect.stringContaining('Tool arguments are not valid JSON'),
            metadata: {
              rawArguments: 'invalid json',
              parsedArguments: {},
            },
          }),
          scope: expect.objectContaining({
            toolName: 'search',
            toolCallId: 'call_1',
          }),
        })
      );
    });

    it('收到 AbortError 时应先结算当前调用，再向上抛出且不继续回 llm', async () => {
      const abortError = new Error('The user aborted a request.');
      abortError.name = 'AbortError';
      executeToolMock.mockRejectedValue(abortError);
      const publishedEvents: RuntimeEvent[] = [];
      const admittedSink = createRuntimeEventAdmissionSink('conv_1', 'run_abort');

      const state: EngineState = {
        nodeId: 'tool',
        local: {
          conversationId: 'conv_1',
          turnId: 'turn_1',
          runtimeEventSink: (event, source) => {
            publishedEvents.push(event);
            return admittedSink(event, source);
          },
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('call_abort'),
              type: 'function' as const,
              function: { name: 'delegate', arguments: '{}' },
            },
          ],
          toolContext: {},
        },
      };

      await expect(toolNode.run(state)).rejects.toMatchObject({
        name: 'AbortError',
        message: 'The user aborted a request.',
      });
      expect(publishedEvents.filter(event => event.type === 'tool_output')).toEqual([
        expect.objectContaining({
          type: 'tool_output',
          tool_call_id: 'call_abort',
          status: 'error',
          error: 'Tool call was cancelled during execution because the run was aborted.',
          observation: 'Tool call was cancelled during execution because the run was aborted.',
        }),
      ]);
      expect(state.local?.pendingToolCalls).toEqual([]);
    });
  });

  describe('4. SSE 事件分发', () => {
    it('应该通过 runtimeEventSink 分发事件', async () => {
      const mockSseSink = vi.fn(createRuntimeEventAdmissionSink('conv_1', 'run_dispatch'));
      executeToolMock.mockResolvedValue({
        success: true,
        result: structuredToolResult('OK'),
      });

      const state: EngineState = {
        nodeId: 'tool',
        local: {
          conversationId: 'conv_1',
          turnId: 'turn_1',
          runtimeEventSink: mockSseSink,
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('call_1'),
              type: 'function' as const,
              function: { name: 'search', arguments: '{}' },
            },
          ],
          toolContext: {},
        },
      };

      await toolNode.run(state);

      expect(mockSseSink).toHaveBeenCalled();
    });

    it('runtimeEventSink 失败时应该终止执行并向上传播', async () => {
      const mockSseSink = vi.fn(() => {
        throw new Error('SSE failed');
      });
      executeToolMock.mockResolvedValue({
        success: true,
        result: structuredToolResult('OK'),
      });

      const state: EngineState = {
        nodeId: 'tool',
        local: {
          conversationId: 'conv_1',
          turnId: 'turn_1',
          runtimeEventSink: mockSseSink,
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('call_1'),
              type: 'function' as const,
              function: { name: 'search', arguments: '{}' },
            },
          ],
          toolContext: {},
        },
      };

      await expect(toolNode.run(state)).rejects.toThrow('SSE failed');
    });
  });

  describe('5. 历史事件管理', () => {
    it('应该更新历史事件', async () => {
      executeToolMock.mockResolvedValue({
        success: true,
        result: structuredToolResult('OK'),
      });

      const existingHistory: RuntimeEvent[] = [
        {
          type: 'user_input',
          id: 'u1',
          timestamp: 1,
          conversation_id: 'conv_1',
          turn_id: 'turn_1',
          version: 1,
          source: 'user',
          content: 'hello',
        },
      ];
      const state: EngineState = {
        nodeId: 'tool',
        local: {
          conversationId: 'conv_1',
          turnId: 'turn_1',
          runtimeEventSink: createRuntimeEventAdmissionSink('conv_1', 'run_history'),
          history: existingHistory,
          pendingToolCalls: [
            {
              id: ToolCallIdSchema.parse('call_1'),
              type: 'function' as const,
              function: { name: 'search', arguments: '{}' },
            },
          ],
          toolContext: {},
        },
      };

      await toolNode.run(state);

      expect(state.local?.history).toBeDefined();
      expect((state.local?.history as any[]).length).toBeGreaterThan(existingHistory.length);
    });
  });
});
