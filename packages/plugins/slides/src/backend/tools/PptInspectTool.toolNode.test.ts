import { describe, expect, it, vi } from 'vitest';
import {
  ToolNode,
  execution,
  type EngineState,
  type ObservationPreviewPort,
  type RuntimeEventSink,
} from '@linnlabs/linnkit/runtime-kernel';
import { RunIdSchema, ToolCallIdSchema } from '@linnlabs/linnkit/contracts';
import { PptInspectTool } from './PptInspectTool';

class InspectToolWithPublicAdmission extends PptInspectTool {
  public override validateArguments(args: Record<string, unknown>) {
    return super.validateArguments(args);
  }
}

function createRuntimeEventSink(): RuntimeEventSink {
  const sequencer = new execution.EventSequencer('conversation-ppt-inspect-admission');
  const eventBus = new execution.EventBus(sequencer.getExecutionId());
  const publisher = new execution.RuntimeEventPublisher(eventBus, sequencer, {
    run_id: RunIdSchema.parse('run-ppt-inspect-admission'),
    lane: 'foreground',
    visibility: 'conversation',
  });
  return (event, source) => publisher.publish(event, source);
}

describe('PptInspectTool ToolNode admission', () => {
  it('在 tool_process(start) 前拒绝违反 owner contract 的参数', async () => {
    const tool = new InspectToolWithPublicAdmission();
    const executeTool = vi.fn();
    const observationPreview: ObservationPreviewPort = {
      truncateObservation: vi.fn(async ({ text }) => ({ truncated: false, preview: text })),
    };
    const node = new ToolNode({
      toolRuntime: {
        getToolDefinition: () => ({
          parameters: tool.parameters,
          validateArguments: (args) => tool.validateArguments(args),
        }),
        executeTool,
      },
      observationPreview,
    });
    const state: EngineState = {
      nodeId: 'tool',
      local: {
        conversationId: 'conversation-ppt-inspect-admission',
        turnId: 'turn-ppt-inspect-admission',
        runtimeEventSink: createRuntimeEventSink(),
        pendingToolCalls: [{
          id: ToolCallIdSchema.parse('call-ppt-inspect-invalid'),
          type: 'function',
          function: {
            name: 'ppt_inspect',
            arguments: JSON.stringify({
              presentation_id: 'deck-1',
              inode: 'inode-1',
            }),
          },
        }],
        toolContext: {},
      },
    };

    const result = await node.run(state);

    expect(result.kind).toBe('route');
    expect(executeTool).not.toHaveBeenCalled();
    expect(state.local?.history?.filter((event) => event.type === 'tool_process')).toHaveLength(0);
    const outputs = state.local?.history?.filter((event) => event.type === 'tool_output') ?? [];
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ status: 'error' });
  });
});
