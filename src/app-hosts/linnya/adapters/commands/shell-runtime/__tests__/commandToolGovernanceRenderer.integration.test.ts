import { describe, expect, it } from 'vitest';
import { ShellToolStructuredResultSchema } from '@app/schemas/commands';
import {
  execution,
  ToolNode,
  type EngineState,
  type ObservationPreviewPort,
  type ToolRuntimePort,
} from '@linnlabs/linnkit/runtime-kernel';
import {
  RunIdSchema,
  ToolCallIdSchema,
  type RuntimeEvent,
} from '@linnlabs/linnkit/contracts';

import { projectCommandExecutionPresentation } from '../../../../../../../apps/renderer/domains/conversation/features/command-execution-presentation/functions/projectCommandExecutionPresentation';

const HANDLE = 'command_process_123e4567-e89b-42d3-a456-426614174000';

describe('command tool governance to renderer', () => {
  it('超长模型正文经 ToolNode 治理后仍能投影卡片，且卡片不显示控制协议', async () => {
    const presentationText = `stdout:\n${'x'.repeat(25_000)}`;
    const controlLine = `command_control: {"protocol_version":1,"kind":"shell_model_control","status":"running","process_handle":"${HANDLE}","next_cursor":2}`;
    const result = {
      data: {
        status: 'running' as const,
        presentationText,
        processHandle: HANDLE,
        nextCursor: 2,
        display: {
          mode: 'pipe' as const,
          coverage: 'complete' as const,
          outputPhase: 'open' as const,
          textProjection: 'available' as const,
        },
      },
      observation: `${controlLine}\n\noutput:\n${presentationText}`,
    };
    const toolRuntime: Pick<ToolRuntimePort, 'getToolDefinition' | 'executeTool'> = {
      getToolDefinition: () => ({ parameters: { type: 'object', properties: {} } }),
      executeTool: async () => ({
        success: true,
        result: JSON.stringify(result),
        durationMs: 1,
      }),
    };
    const observationPreview: ObservationPreviewPort = {
      async truncateObservation({ text, maxChars, maxLines }) {
        expect(text.length).toBeGreaterThan(maxChars);
        expect(maxChars).toBe(20_000);
        expect(maxLines).toBe(1_200);
        return {
          truncated: true,
          preview: `${controlLine}\n\noutput:\npreview tail`,
          blob_id: '0123456789abcdef',
        };
      },
    };
    const sequencer = new execution.EventSequencer('conv-command-long-output');
    const eventBus = new execution.EventBus(sequencer.getExecutionId());
    const publisher = new execution.RuntimeEventPublisher(eventBus, sequencer, {
      run_id: RunIdSchema.parse('run-command-long-output'),
      lane: 'foreground',
      visibility: 'conversation',
    });
    const state: EngineState = {
      nodeId: 'tool',
      local: {
        conversationId: 'conv-command-long-output',
        turnId: 'turn-command-long-output',
        toolContext: {},
        runtimeEventSink: (event, source) => publisher.publish(event, source),
        pendingToolCalls: [{
          id: ToolCallIdSchema.parse('call-command-long-output'),
          type: 'function',
          function: { name: 'shell', arguments: '{}' },
        }],
      },
    };
    await new ToolNode({ toolRuntime, observationPreview }).run(state);

    const history: RuntimeEvent[] = state.local?.history ?? [];
    const toolOutput = history.find(event => event.type === 'tool_output');
    if (!toolOutput || toolOutput.type !== 'tool_output') {
      throw new Error('expected governed shell tool output');
    }
    const governed = ShellToolStructuredResultSchema.parse({
      data: toolOutput.data,
      observation: toolOutput.observation,
    });
    const projected = projectCommandExecutionPresentation({
      sourceToolName: 'shell',
      uiKey: 'shell',
      args: { command: 'long-output', interactive: false },
      result: governed,
      status: 'success',
      phase: 'complete',
    });

    expect(governed.data.tool_output_store).toBeUndefined();
    expect(toolOutput.metadata?.observationTruncation).toMatchObject({
      blobId: '0123456789abcdef',
    });
    expect(governed.observation).toContain('command_control:');
    expect(projected.data).toMatchObject({
      kind: 'command_execution',
      observation: presentationText,
    });
    expect(projected.data.observation).not.toContain('command_control:');
  });
});
