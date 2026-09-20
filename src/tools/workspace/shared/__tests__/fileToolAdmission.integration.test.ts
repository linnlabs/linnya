import { describe, expect, it } from 'vitest';
import { execution, ToolNode, type EngineState } from '@linnlabs/linnkit/runtime-kernel';
import { RunIdSchema, ToolCallIdSchema } from '@linnlabs/linnkit/contracts';
import { createToolRuntimeHarness } from 'src/app-hosts/linnya/testkit/agent-harness/toolRegistryHarness';
import { defaultObservationPreviewPort } from 'src/app-hosts/linnya/adapters/tools/defaultPorts';
import { WriteFileTool } from '../../write_file/WriteFileTool';
import { EditFileTool } from '../../edit_file/EditFileTool';
import { ReadFileTool } from '../../read_file/ReadFileTool';
import { ListFilesTool } from '../../list_files/ListFilesTool';
import { GrepTool } from '../../grep/GrepTool';
import { WebReadTool } from '../../../web/webread/WebReadTool';

describe('文件与网页读取的参数失败闭环', () => {
  it.each([
    { tool: new WriteFileTool(), args: { locator: 'conversation:/report.md', content: 'private report' } },
    { tool: new EditFileTool(), args: { locator: 'workspace:/report.md', inode: 'workspace:doc', old_string: 'private original', new_string: 'private replacement' } },
    { tool: new ReadFileTool(), args: { locator: '/report.md' } },
    { tool: new ListFilesTool(), args: { locator: 'file:///report.md' } },
    { tool: new GrepTool(), args: { locator: 'conversation:/report.md', pattern: 'private query' } },
    { tool: new WebReadTool(), args: { url: 'file:///report.md' } },
  ])('$tool.name 在执行前拒绝错误身份，并提供可通过同一 admission 的修复示例', async ({ tool, args }) => {
    const harness = createToolRuntimeHarness([tool]);
    const sequencer = new execution.EventSequencer('conv-file-admission');
    const publisher = new execution.RuntimeEventPublisher(new execution.EventBus(sequencer.getExecutionId()), sequencer, {
      run_id: RunIdSchema.parse('run-file-admission'), lane: 'foreground', visibility: 'conversation',
    });
    const state: EngineState = {
      nodeId: 'tool',
      local: {
        conversationId: 'conv-file-admission', turnId: 'turn-file-admission', toolContext: {},
        runtimeEventSink: (event, source) => publisher.publish(event, source),
        pendingToolCalls: [{
          id: ToolCallIdSchema.parse('call-file-invalid'), type: 'function',
          function: { name: tool.name, arguments: JSON.stringify(args) },
        }],
      },
    };
    try {
      await new ToolNode({ toolRuntime: harness.toolRuntime, observationPreview: defaultObservationPreviewPort }).run(state);
      expect(harness.getExecutions()).toEqual([]);
      const history = state.local?.history ?? [];
      expect(history.filter(event => event.type === 'tool_process')).toEqual([]);
      const outputs = history.filter(event => event.type === 'tool_output');
      expect(outputs).toHaveLength(1);
      expect(outputs[0]?.status).toBe('error');
      const error = outputs[0]?.error ?? '';
      expect(error).not.toContain('private');
      const example: unknown = JSON.parse(error.split('最小结构示例：')[1] ?? 'null');
      if (!example || typeof example !== 'object' || Array.isArray(example)) throw new Error('missing repair example');
      expect(harness.toolRuntime.getToolDefinition(tool.name)?.validateArguments?.({ ...example })).toEqual({ success: true });
    } finally {
      harness.restore();
    }
  });
});
