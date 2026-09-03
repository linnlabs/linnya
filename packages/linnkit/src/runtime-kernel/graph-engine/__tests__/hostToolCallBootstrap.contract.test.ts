import { describe, expect, it, vi } from 'vitest';
import {
  createHostToolCallBootstrap,
  execution,
  GraphExecutor,
  MemoryCheckpointer,
  ToolNode,
  type GraphNode,
  type RuntimeEventSink,
} from '../../index';
import {
  createUserInputEvent,
  RuntimeEvent as RuntimeEventSchema,
  type RuntimeEvent,
  RunIdSchema,
} from '../../../contracts';
import type { ObservationPreviewPort, ToolRuntimePort } from '../../tools';

describe('createHostToolCallBootstrap', () => {
  it('用同一份身份和参数构造 tool call、decision event 与 tool 起点', () => {
    const previous = createUserInputEvent(
      'event-user',
      'conversation-1',
      'turn-1',
      'run the system tool'
    );
    const bootstrap = createHostToolCallBootstrap({
      eventId: 'event-decision',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      toolName: 'system_task',
      toolCallId: 'call-system-task',
      args: { unit_id: 'unit-1', count: 3 },
      history: [previous],
      timestamp: 123,
      metadata: { run_id: 'run-1' },
      decisionMeta: { source: 'host' },
    });

    expect(bootstrap.nodeId).toBe('tool');
    expect(bootstrap.toolCall).toEqual({
      id: 'call-system-task',
      type: 'function',
      function: {
        name: 'system_task',
        arguments: '{"unit_id":"unit-1","count":3}',
      },
    });
    expect(bootstrap.decisionEvent).toMatchObject({
      id: 'event-decision',
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      timestamp: 123,
      tool_name: 'system_task',
      tool_call_id: 'call-system-task',
      args: { unit_id: 'unit-1', count: 3 },
      payload: {
        args: { unit_id: 'unit-1', count: 3 },
        tool_calls: [bootstrap.toolCall],
      },
      meta: {
        source: 'host',
        primary_tool_call_id: 'call-system-task',
        tool_call_ids: ['call-system-task'],
        tool_batch_size: 1,
      },
    });
    expect(RuntimeEventSchema.safeParse(bootstrap.decisionEvent).success).toBe(true);
    expect(bootstrap.localPatch.history).toEqual([previous, bootstrap.decisionEvent]);
    expect(bootstrap.localPatch.pendingToolCalls).toEqual([bootstrap.toolCall]);
  });

  it('通过 runtime-kernel 公开 API 直入 ToolNode，并在工具完成后回到 llm', async () => {
    const executeTool = vi.fn<ToolRuntimePort['executeTool']>(async () => ({
      success: true,
      result: JSON.stringify({ observation: 'system task completed', data: { ok: true } }),
      durationMs: 1,
    }));
    const toolRuntime: Pick<ToolRuntimePort, 'getToolDefinition' | 'executeTool'> = {
      getToolDefinition: () => ({
        parameters: { type: 'object', properties: {} },
      }),
      executeTool,
    };
    const observationPreview: ObservationPreviewPort = {
      truncateObservation: async ({ text }) => ({ truncated: false, preview: text }),
    };
    let llmHistory: RuntimeEvent[] = [];
    const llmNode: GraphNode = {
      id: 'llm',
      async run(state) {
        llmHistory = state.local?.history ?? [];
        return { kind: 'yield', events: [] };
      },
    };
    const executor = new GraphExecutor(new MemoryCheckpointer(), { maxSteps: 4 });
    executor.registerNode(new ToolNode({ toolRuntime, observationPreview }));
    executor.registerNode(llmNode);
    const bootstrap = createHostToolCallBootstrap({
      eventId: 'event-system-decision',
      conversationId: 'conversation-system',
      turnId: 'turn-system',
      toolName: 'system_task',
      toolCallId: 'call-system',
      args: { value: 42 },
    });
    const sequencer = new execution.EventSequencer('conversation-system');
    const eventBus = new execution.EventBus(sequencer.getExecutionId());
    const publisher = new execution.RuntimeEventPublisher(eventBus, sequencer, {
      run_id: RunIdSchema.parse('run-system'),
      lane: 'foreground',
      visibility: 'conversation',
    });
    const runtimeEventSink: RuntimeEventSink = (event, source) => publisher.publish(event, source);

    await executor.prime(
      'checkpoint-system',
      {
        ...bootstrap.localPatch,
        toolContext: {},
        runtimeEventSink,
      },
      bootstrap.nodeId
    );
    const result = await executor.runUntilYield('checkpoint-system');

    expect(executeTool).toHaveBeenCalledWith(
      'system_task',
      { value: 42 },
      expect.objectContaining({ conversationId: 'conversation-system', turnId: 'turn-system' })
    );
    expect(result.stepCount).toBe(2);
    expect(result.events.some(event => event.type === 'tool_output')).toBe(true);
    expect(llmHistory.map(event => event.type)).toEqual([
      'tool_call_decision',
      'tool_process',
      'tool_output',
    ]);
  });

  it('拒绝缺失稳定身份的 host 起点', () => {
    expect(() =>
      createHostToolCallBootstrap({
        eventId: 'event-decision',
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        toolName: ' ',
        toolCallId: 'call-1',
        args: {},
      })
    ).toThrow('host tool bootstrap requires non-empty toolName');
  });
});
