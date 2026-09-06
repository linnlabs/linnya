import { describe, expect, it, vi } from 'vitest';
import { execution, ToolNode, type EngineState } from '@linnlabs/linnkit/runtime-kernel';
import { RunIdSchema, ToolCallIdSchema } from '@linnlabs/linnkit/contracts';
import { createToolRuntimeHarness } from 'src/app-hosts/linnya/testkit/agent-harness/toolRegistryHarness';
import { defaultObservationPreviewPort } from 'src/app-hosts/linnya/adapters/tools/defaultPorts';
import { applyExactTextReplacement } from 'src/features/workspace/document-file-write/functions/applyExactTextReplacement';
import { EditFileTool } from '../../edit_file/EditFileTool';
import { WriteFileTool } from '../../write_file/WriteFileTool';
import type { BaseTool } from '../../../types';

describe('mutable file tools through ToolNode working history', () => {
  it.each(['write', 'edit'] as const)('%s 不复用旧状态的同参结果，重复修改产生新的持久结束事件', async mode => {
    const tool: BaseTool = mode === 'edit' ? new EditFileTool() : new WriteFileTool();
    let content = 'A';
    // 隔离文档存储，保留正式工具 admission / policy、ToolNode 与 working history。
    const mutation = vi.spyOn(tool, 'run').mockImplementation(async args => {
      if (mode === 'edit') {
        if (typeof args.old_string !== 'string' || typeof args.new_string !== 'string') throw new Error('invalid edit');
        content = applyExactTextReplacement({ source: content, oldString: args.old_string, newString: args.new_string, replaceAll: false }).text;
      } else {
        if (typeof args.content !== 'string') throw new Error('invalid write');
        content = args.content;
      }
      return JSON.stringify({ data: { content }, observation: content });
    });
    const harness = createToolRuntimeHarness([tool]);
    try {
      const sequencer = new execution.EventSequencer('conv-mutable-file');
      const publisher = new execution.RuntimeEventPublisher(new execution.EventBus(sequencer.getExecutionId()), sequencer, {
        run_id: RunIdSchema.parse('run-mutable-file'), lane: 'foreground', visibility: 'conversation',
      });
      const args = mode === 'edit'
        ? [{ old_string: 'A', new_string: 'B' }, { old_string: 'B', new_string: 'A' }, { old_string: 'A', new_string: 'B' }]
        : [{ content: 'B' }, { content: 'A' }, { content: 'B' }];
      const state: EngineState = {
        nodeId: 'tool',
        local: {
          conversationId: 'conv-mutable-file', turnId: 'turn-mutable-file', history: [], toolContext: {},
          runtimeEventSink: (event, source) => publisher.publish(event, source),
          pendingToolCalls: args.map((arg, index) => ({
            id: ToolCallIdSchema.parse(`call-${index}`), type: 'function',
            function: { name: tool.name, arguments: JSON.stringify({ locator: 'workspace:/deck.slides', ...arg }) },
          })),
        },
      };
      const node = new ToolNode({ toolRuntime: harness.toolRuntime, observationPreview: defaultObservationPreviewPort });
      for (let index = 0; index < args.length; index++) await node.run(state);
      expect(content).toBe('B');
      expect(mutation).toHaveBeenCalledTimes(3);
      const outputs = (state.local?.history ?? []).filter(event => event.type === 'tool_output');
      expect(outputs.map(event => event.tool_call_id)).toEqual(['call-0', 'call-1', 'call-2']);
      expect(outputs.every(event => event.status === 'success' && event.ephemeral !== true)).toBe(true);
    } finally {
      mutation.mockRestore();
      harness.restore();
    }
  });
});
