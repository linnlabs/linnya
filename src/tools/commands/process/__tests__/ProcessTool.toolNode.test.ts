import { describe, expect, it } from 'vitest';
import {
  execution,
  ToolNode,
  type EngineState,
} from '@linnlabs/linnkit/runtime-kernel';
import { RunIdSchema, ToolCallIdSchema } from '@linnlabs/linnkit/contracts';
import { defaultObservationPreviewPort } from 'src/app-hosts/linnya/adapters/tools/defaultPorts';
import { createToolRuntimeHarness } from 'src/app-hosts/linnya/testkit/agent-harness/toolRegistryHarness';
import { ProcessTool } from '../ProcessTool';

const PROCESS_HANDLE = 'command_process_123e4567-e89b-42d3-a456-426614174000';

function createRuntimeEventSink() {
  const sequencer = new execution.EventSequencer('conversation-process-protocol');
  const eventBus = new execution.EventBus(sequencer.getExecutionId());
  const publisher = new execution.RuntimeEventPublisher(eventBus, sequencer, {
    run_id: RunIdSchema.parse('run-process-protocol'),
    lane: 'foreground',
    visibility: 'conversation',
  });
  return (event: Parameters<typeof publisher.publish>[0], source: Parameters<typeof publisher.publish>[1]) =>
    publisher.publish(event, source);
}

describe('ProcessTool ToolNode admission', () => {
  it('协议错误不发布 start，并在连续四次错误后触发 protocol fuse', async () => {
    const harness = createToolRuntimeHarness([new ProcessTool()]);
    const state: EngineState = {
      nodeId: 'tool',
      local: {
        conversationId: 'conversation-process-protocol',
        turnId: 'turn-process-protocol',
        runtimeEventSink: createRuntimeEventSink(),
        toolContext: {},
        pendingToolCalls: Array.from({ length: 4 }, (_, index) => ({
          id: ToolCallIdSchema.parse(`call-process-protocol-${index}`),
          type: 'function' as const,
          function: {
            name: 'process',
            arguments: JSON.stringify({
              process_handle: PROCESS_HANDLE,
              action: { type: 'wait' },
            }),
          },
        })),
      },
    };

    try {
      await expect(
        new ToolNode({
          toolRuntime: harness.toolRuntime,
          observationPreview: defaultObservationPreviewPort,
        }).run(state),
      ).rejects.toMatchObject({
        name: 'ToolProtocolFuseError',
        errorCode: 'tool.protocol_fuse',
      });

      const history = state.local?.history ?? [];
      expect(history.filter(event => event.type === 'tool_process')).toHaveLength(0);
      const outputs = history.filter(event => event.type === 'tool_output');
      expect(outputs).toHaveLength(4);
      expect(outputs.every(event => event.status === 'error')).toBe(true);
      expect(outputs.every(event => event.error?.includes('process_protocol_violation'))).toBe(true);
    } finally {
      harness.restore();
    }
  });
});
