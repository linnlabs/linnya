import { describe, expect, it } from 'vitest';
import {
  execution,
  ToolNode,
  type EngineState,
} from '@linnlabs/linnkit/runtime-kernel';
import { RunIdSchema, ToolCallIdSchema } from '@linnlabs/linnkit/contracts';
import { ProcessToolArgumentsV1Schema } from '@app/schemas/commands';
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
  it.each([
    { args: { process_handle: PROCESS_HANDLE, action: 'wait' }, fields: ['action：必须是对象'] },
    { args: { action: { type: 'wait', process_handle: PROCESS_HANDLE } }, fields: ['process_handle：缺少必需字段', 'action.process_handle：不允许的字段', 'action.cursor：缺少必需字段'] },
    { args: { process_handle: PROCESS_HANDLE, action: { type: 'wait', cursor: 0, wait_timeout_ms: 0 } }, fields: ['action.wait_timeout_ms'] },
    { args: { process_handle: PROCESS_HANDLE, action: { type: 'poll', cursor: -1 } }, fields: ['action.cursor'] },
    { args: { process_handle: PROCESS_HANDLE, action: { type: 'cancel', cursor: 0 } }, fields: ['action.cursor：不允许的字段'] },
    { args: { process_handle: PROCESS_HANDLE, action: { type: 'write', input: '' } }, fields: ['action.input'] },
    { args: { process_handle: PROCESS_HANDLE, action: { type: 'submit' } }, fields: ['action.input：缺少必需字段'] },
    { args: { process_handle: PROCESS_HANDLE, action: { type: 'eof', input: 'private-input' } }, fields: ['action.input：不允许的字段'] },
    { args: { process_handle: PROCESS_HANDLE, action: { type: 'resize', columns: 0, rows: 24 } }, fields: ['action.columns'] },
  ])('owner admission 精确定位错误且示例可通过正式合同：$fields', async ({ args, fields }) => {
    const harness = createToolRuntimeHarness([new ProcessTool()]);
    const state: EngineState = {
      nodeId: 'tool',
      local: {
        conversationId: 'conversation-process-protocol',
        turnId: 'turn-process-protocol',
        runtimeEventSink: createRuntimeEventSink(),
        toolContext: {},
        pendingToolCalls: [{
          id: ToolCallIdSchema.parse('call-process-invalid'),
          type: 'function',
          function: { name: 'process', arguments: JSON.stringify(args) },
        }],
      },
    };
    try {
      await new ToolNode({
        toolRuntime: harness.toolRuntime,
        observationPreview: defaultObservationPreviewPort,
      }).run(state);
      expect(harness.getExecutions()).toEqual([]);
      const history = state.local?.history ?? [];
      expect(history.filter(event => event.type === 'tool_process')).toEqual([]);
      const outputs = history.filter(event => event.type === 'tool_output');
      expect(outputs).toHaveLength(1);
      const message = outputs[0]?.error ?? '';
      for (const field of fields) expect(message).toContain(field);
      expect(message).not.toContain('private-input');
      expect(message).not.toContain('action.wait 必须');
      const exampleLine = message.split('最小结构示例：')[1]?.split('\n')[0];
      expect(exampleLine).toBeDefined();
      const example: unknown = JSON.parse(exampleLine ?? 'null');
      expect(ProcessToolArgumentsV1Schema.safeParse(example).success).toBe(true);
    } finally {
      harness.restore();
    }
  });

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
