import { describe, expect, it, vi } from 'vitest';
import {
  execution,
  ToolNode,
  type EngineState,
} from '../../../../runtime-kernel';
import type {
  ObservationPreviewPort,
  ToolRuntimePort,
} from '../../../../runtime-kernel/tools';
import {
  RunIdSchema,
  ToolCallIdSchema,
  type RuntimeEvent,
} from '../../../../contracts';

import { convertEventsToAiMessages } from './eventConverter';

describe('command display data isolation', () => {
  it('ToolNode working history 保留展示事实，但 provider 消息只读取 observation', async () => {
    const result = {
      data: {
        status: 'running',
        processHandle: 'command_process_123e4567-e89b-42d3-a456-426614174000',
        nextCursor: 1,
        display: {
          mode: 'pty',
          coverage: 'complete',
          outputPhase: 'open',
          textProjection: 'available',
          screen: {
            mode: 'pty',
            scope: 'terminal_window',
            revision: 1,
            columns: 10,
            rows: 1,
            active_buffer: 'normal',
            total_buffer_lines: 1,
            window_start_line: 0,
            viewport_start_line: 0,
            scrollback_lines: 0,
            omitted_before_lines: 0,
            cursor: { column: 0, row: 0 },
            lines: [{
              wrapped: false,
              text: 'renderer only',
              cell_metrics: [],
              style_runs: [],
            }],
          },
        },
      },
      observation: 'terminal text',
    };
    const executeTool = vi.fn<ToolRuntimePort['executeTool']>(async () => ({
      success: true,
      result: JSON.stringify(result),
      durationMs: 1,
    }));
    const toolRuntime: Pick<ToolRuntimePort, 'getToolDefinition' | 'executeTool'> = {
      getToolDefinition: () => ({ parameters: { type: 'object', properties: {} } }),
      executeTool,
    };
    const observationPreview: ObservationPreviewPort = {
      truncateObservation: async ({ text }) => ({ truncated: false, preview: text }),
    };
    const sequencer = new execution.EventSequencer('conv-command-display');
    const eventBus = new execution.EventBus(sequencer.getExecutionId());
    const publisher = new execution.RuntimeEventPublisher(eventBus, sequencer, {
      run_id: RunIdSchema.parse('run-command-display'),
      lane: 'foreground',
      visibility: 'conversation',
    });
    const state: EngineState = {
      nodeId: 'tool',
      local: {
        conversationId: 'conv-command-display',
        turnId: 'turn-command-display',
        toolContext: {},
        runtimeEventSink: (event, source) => publisher.publish(event, source),
        pendingToolCalls: [{
          id: ToolCallIdSchema.parse('call-command-display'),
          type: 'function',
          function: { name: 'shell', arguments: '{}' },
        }],
      },
    };
    const node = new ToolNode({ toolRuntime, observationPreview });

    await node.run(state);

    const history: RuntimeEvent[] = state.local?.history ?? [];
    const toolOutput = history.find(event => event.type === 'tool_output');
    expect(toolOutput).toMatchObject({
      observation: result.observation,
      data: result.data,
    });
    expect(toolOutput).not.toHaveProperty('control');
    const [message] = convertEventsToAiMessages(history);
    if (!message) throw new Error('expected provider working-history message');
    expect(message.content).toBe('terminal text');
    expect(message.content).not.toContain('renderer only');
    expect(message.content).not.toContain('display');
  });
});
