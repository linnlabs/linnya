import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineState } from '../../types';

const { getToolDefinitionMock } = vi.hoisted(() => ({
  getToolDefinitionMock: vi.fn(),
}));

import { prepareToolExecution, prepareToolNodeContext } from '../toolNode.executionSetup';
import { createRuntimeEventAdmissionSink } from './runtimeEventAdmissionFixture';
import { createToolOutputEvent, RunIdSchema, ToolCallIdSchema } from '../../../../contracts';

describe('toolNode.executionSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getToolDefinitionMock.mockReturnValue({
      parameters: { type: 'object', properties: {} },
      idempotency: { scope: 'conversation' },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prepareToolNodeContext 应维持 working history 视图', () => {
    const baseGetHistory = vi.fn(() => []);
    const state: EngineState = {
      nodeId: 'tool',
      local: {
        conversationId: 'conv_1',
        turnId: 'turn_1',
        runtimeEventSink: createRuntimeEventAdmissionSink('conv_1', 'run_1'),
        toolContext: {
          conversationView: {
            getWorkingHistoryEvents: baseGetHistory,
            getPersistedHistoryEvents: baseGetHistory,
          },
        },
        history: [
          createToolOutputEvent(
            'event-citations',
            'conv_1',
            'turn_1',
            'search',
            'call-citations',
            {
              status: 'success',
              observation: 'citations',
              data: {
                citations: {
                  citations: [{ id: 'c1' }, { id: 'c2' }],
                },
              },
            }
          ),
        ],
      },
    };

    const prepared = prepareToolNodeContext(state);

    expect(prepared.toolContext.conversationView).toBeTruthy();
    const history = prepared.toolContext.conversationView?.getWorkingHistoryEvents();
    expect(Array.isArray(history)).toBe(true);
    expect(history ?? []).toHaveLength(1);
    expect(baseGetHistory).not.toHaveBeenCalled();
    expect(prepared.toolContext.conversationView?.getPersistedHistoryEvents()).toEqual([]);
    expect(baseGetHistory).toHaveBeenCalledTimes(1);
  });

  it('prepareToolExecution 应规范化调用装配 bridge 与运行时 toolContext', () => {
    const state: EngineState = {
      nodeId: 'tool',
      local: {
        conversationId: 'internal_1',
        turnId: 'turn_1',
        toolContext: {
          conversationId: 'conv_root_1',
        },
        runtimeEventSink: createRuntimeEventAdmissionSink('internal_1', 'run_1'),
      },
    };

    const prepared = prepareToolNodeContext(state);
    const execution = prepareToolExecution({
      prepared,
      call: {
        id: ToolCallIdSchema.parse('call_1'),
        type: 'function',
        function: {
          name: 'search',
          arguments: '{"query":"hello"}',
        },
      },
      toolCatalog: {
        getToolDefinition: getToolDefinitionMock,
      },
    });

    expect(execution).toBeTruthy();
    expect(execution?.toolName).toBe('search');
    expect(execution?.toolCallId).toBe('call_1');
    expect(execution?.idempotencyKey).toMatch(/^[a-f0-9]{32}$/);
    expect(prepared.toolContext.parentToolCallId).toBe('call_1');
    expect(prepared.toolContext.conversationId).toBe('conv_root_1');
    expect(prepared.toolContext.turnId).toBe('turn_1');
  });

  it('prepareToolExecution 在未注入 toolCatalog 时不应隐式依赖宿主默认实现', () => {
    const state: EngineState = {
      nodeId: 'tool',
      local: {
        conversationId: 'internal_2',
        turnId: 'turn_2',
        toolContext: {},
        runtimeEventSink: createRuntimeEventAdmissionSink('internal_2', 'run_2'),
      },
    };

    const prepared = prepareToolNodeContext(state);
    const execution = prepareToolExecution({
      prepared,
      call: {
        id: ToolCallIdSchema.parse('call_2'),
        type: 'function',
        function: {
          name: 'search',
          arguments: '{"query":"hello"}',
        },
      },
    });

    expect(execution).toBeTruthy();
    expect(execution?.toolArgs).toEqual({ query: 'hello' });
    expect(getToolDefinitionMock).not.toHaveBeenCalled();
  });

  it('prepareToolExecution 应将 schema 期望的 JSON 编码数组字符串归一化为真实数组', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getToolDefinitionMock.mockReturnValue({
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'PPT 标题' },
          pages: {
            type: 'array',
            description: '逐页计划',
            items: {
              type: 'object',
              description: '单页计划',
              properties: {
                title: { type: 'string', description: '页标题' },
                content: { type: 'string', description: '页内容' },
              },
              required: ['title', 'content'],
            },
          },
        },
      },
      idempotency: { scope: 'conversation' },
    });

    const state: EngineState = {
      nodeId: 'tool',
      local: {
        conversationId: 'internal_3',
        turnId: 'turn_3',
        toolContext: {},
        runtimeEventSink: createRuntimeEventAdmissionSink('internal_3', 'run_3'),
      },
    };

    const prepared = prepareToolNodeContext(state);
    const execution = prepareToolExecution({
      prepared,
      call: {
        id: ToolCallIdSchema.parse('call_3'),
        type: 'function',
        function: {
          name: 'ppt_plan',
          arguments:
            '{"title":"Deck","pages":"[{\\"title\\":\\"Overview\\",\\"content\\":\\"Summary\\"}]"}',
        },
      },
      toolCatalog: {
        getToolDefinition: getToolDefinitionMock,
      },
    });

    expect(execution).toBeTruthy();
    expect(execution?.toolArgs).toEqual({
      title: 'Deck',
      pages: [{ title: 'Overview', content: 'Summary' }],
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[WARN] [ToolArgNormalizer] normalized JSON-encoded tool argument'),
      {
        expectedType: 'array',
        path: 'ppt_plan.pages',
      }
    );
  });

  it('prepareToolExecution 按规范化参数解析本次动态模型输入要求', () => {
    const resolveModelInputRequirement = vi.fn((args: Record<string, unknown>) =>
      args.include_preview === true
        ? {
            requires_image_input: true as const,
            placements: ['tool_result_image'] as const,
          }
        : undefined
    );
    getToolDefinitionMock.mockReturnValue({
      parameters: {
        type: 'object',
        properties: {
          include_preview: {
            type: 'boolean',
            description: '是否返回图片预览',
          },
        },
      },
      resolveModelInputRequirement,
    });
    const prepared = prepareToolNodeContext({
      nodeId: 'tool',
      local: {
        conversationId: 'conversation-dynamic-requirement',
        turnId: 'turn-dynamic-requirement',
        runtimeEventSink: createRuntimeEventAdmissionSink(
          'conversation-dynamic-requirement',
          'run-dynamic-requirement'
        ),
        toolContext: {},
      },
    });

    const execution = prepareToolExecution({
      prepared,
      call: {
        id: ToolCallIdSchema.parse('call-dynamic-requirement'),
        type: 'function',
        function: {
          name: 'dynamic_image_tool',
          arguments: '{"include_preview":true}',
        },
      },
      toolCatalog: { getToolDefinition: getToolDefinitionMock },
    });

    expect(resolveModelInputRequirement).toHaveBeenCalledWith({
      include_preview: true,
    });
    expect(execution?.modelInputRequirement).toEqual({
      requires_image_input: true,
      placements: ['tool_result_image'],
    });
  });

  it('动态模型输入要求解析失败时返回稳定 setup 错误', () => {
    getToolDefinitionMock.mockReturnValue({
      parameters: { type: 'object', properties: {} },
      resolveModelInputRequirement() {
        throw new Error('host secret should not reach tool output');
      },
    });
    const prepared = prepareToolNodeContext({
      nodeId: 'tool',
      local: {
        conversationId: 'conversation-requirement-error',
        turnId: 'turn-requirement-error',
        runtimeEventSink: createRuntimeEventAdmissionSink(
          'conversation-requirement-error',
          'run-requirement-error'
        ),
        toolContext: {},
      },
    });

    const execution = prepareToolExecution({
      prepared,
      call: {
        id: ToolCallIdSchema.parse('call-requirement-error'),
        type: 'function',
        function: { name: 'dynamic_image_tool', arguments: '{}' },
      },
      toolCatalog: { getToolDefinition: getToolDefinitionMock },
    });

    expect(execution?.modelInputRequirement).toBeUndefined();
    expect(execution?.modelInputRequirementError).toBe(
      'tool.model_input.requirement_resolution_failed: Tool model input requirement could not be resolved'
    );
    expect(execution?.modelInputRequirementError).not.toContain('host secret');
  });

  it('prepareToolNodeContext 在 conversation scope 身份缺失时立即失败', () => {
    getToolDefinitionMock.mockReturnValue({
      parameters: { type: 'object', properties: {} },
      idempotency: { scope: 'conversation' },
    });
    const state: EngineState = {
      nodeId: 'tool',
      local: {
        conversationId: '',
        turnId: 'turn_4',
        toolContext: {},
        runtimeEventSink: createRuntimeEventAdmissionSink('conversation-invalid', 'run-invalid'),
      },
    };

    expect(() => prepareToolNodeContext(state)).toThrow(/conversationId/);
  });
});
