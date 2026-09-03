import { describe, expect, it } from 'vitest';
import type {
  ToolCompactStepPresentation,
  ToolLocalizedTextDescriptor,
} from '@linnya/plugin-host-contract/renderer/toolUi';
import type { SSESubRunTraceEvent } from '@linnlabs/linnkit/contracts';
import { ToolCallIdSchema } from '@linnlabs/linnkit/contracts';

import { createAppendOnlySubrunStepProjector } from '../functions/createAppendOnlySubrunStepProjector';

function createEvent(
  id: string,
  kind: SSESubRunTraceEvent['kind'],
  fields: Partial<SSESubRunTraceEvent> = {},
): SSESubRunTraceEvent {
  return {
    type: 'subrun_trace',
    id,
    timestamp: 1,
    conversation_id: 'conversation-1',
    turn_id: 'turn-1',
    parent_tool_call_id: ToolCallIdSchema.parse('parent-tool-1'),
    subrun_id: 'subrun-1',
    source_event_id: `source-${id}`,
    kind,
    ...fields,
  };
}

function title(key: string, params?: Readonly<Record<string, string>>): ToolCompactStepPresentation {
  return {
    title: {
      key,
      fallback: key,
      ...(params ? { params } : {}),
    },
  };
}

describe('createAppendOnlySubrunStepProjector', () => {
  it('decision 不创建步骤，reload output 按 tool_call_id 恢复参数和标题', () => {
    const projector = createAppendOnlySubrunStepProjector(request => {
      if (
        typeof request.args !== 'object'
        || request.args === null
        || Array.isArray(request.args)
        || !('query' in request.args)
        || typeof request.args.query !== 'string'
      ) {
        throw new Error('query required');
      }
      return title('tool.search', { query: request.args.query });
    });
    projector.admit([{
      index: 0,
      event: createEvent('decision', 'tool_call_decision', {
        tool_calls: [{
          tool_call_id: ToolCallIdSchema.parse('call-search'),
          tool_name: 'knowledge_search',
          args: { query: '量子计算' },
        }],
      }),
    }]);
    expect(projector.projection.steps).toEqual([]);

    projector.admit([{
      index: 1,
      event: createEvent('output', 'tool_output', {
        tool_name: 'knowledge_search',
        tool_call_id: ToolCallIdSchema.parse('call-search'),
        status: 'success',
      }),
    }]);

    expect(projector.projection.steps).toEqual([{
      toolCallId: 'call-search',
      toolName: 'knowledge_search',
      title: {
        key: 'tool.search',
        fallback: 'tool.search',
        params: { query: '量子计算' },
      },
      status: 'success',
    }]);
  });

  it('process 与 output 归并同一步骤，并保留 process 时长', () => {
    const projector = createAppendOnlySubrunStepProjector(() => title('tool.workspace.read'));
    projector.admit([{
      index: 0,
      event: createEvent('process', 'tool_process', {
        tool_name: 'read_file',
        tool_call_id: ToolCallIdSchema.parse('call-read'),
        status: 'loading',
        args: { locator: 'workspace:/README.md' },
        duration_ms: 12,
      }),
    }, {
      index: 1,
      event: createEvent('output', 'tool_output', {
        tool_name: 'read_file',
        tool_call_id: ToolCallIdSchema.parse('call-read'),
        status: 'success',
      }),
    }]);

    expect(projector.projection.steps).toEqual([{
      toolCallId: 'call-read',
      toolName: 'read_file',
      title: { key: 'tool.workspace.read', fallback: 'tool.workspace.read' },
      status: 'success',
      durationMs: 12,
    }]);
  });

  it('同名工具按 tool_call_id 保持独立身份', () => {
    const projector = createAppendOnlySubrunStepProjector(() => title('tool.search'));
    projector.admit(['call-1', 'call-2'].map((toolCallId, index) => ({
      index,
      event: createEvent(`process-${index}`, 'tool_process', {
        tool_name: 'web_search',
        tool_call_id: ToolCallIdSchema.parse(toolCallId),
        status: 'loading',
        args: { query: toolCallId },
      }),
    })));

    expect(projector.projection.steps.map(step => step.toolCallId)).toEqual(['call-1', 'call-2']);
  });

  it('整批 projector 失败时保留上一份已接纳快照', () => {
    let shouldFail = false;
    const projector = createAppendOnlySubrunStepProjector(() => {
      if (shouldFail) throw new Error('invalid compact payload');
      return title('tool.shell');
    });
    projector.admit([{
      index: 0,
      event: createEvent('process', 'tool_process', {
        tool_name: 'shell',
        tool_call_id: ToolCallIdSchema.parse('call-shell'),
        status: 'loading',
        args: { command: 'pwd' },
      }),
    }]);
    const previous = projector.projection.steps;
    shouldFail = true;

    expect(() => projector.admit([{
      index: 1,
      event: createEvent('output', 'tool_output', {
        tool_name: 'shell',
        tool_call_id: ToolCallIdSchema.parse('call-shell'),
        status: 'success',
      }),
    }])).toThrow('invalid compact payload');
    expect(projector.projection.steps).toBe(previous);
    expect(projector.projection.steps[0]?.status).toBe('loading');
  });

  it('只有 registry 未命中时生成通用诊断标题', () => {
    const projector = createAppendOnlySubrunStepProjector(() => undefined);
    projector.admit([{
      index: 0,
      event: createEvent('process', 'tool_process', {
        tool_name: 'removed_plugin_tool',
        tool_call_id: ToolCallIdSchema.parse('call-unknown'),
        status: 'loading',
        args: {},
      }),
    }]);

    const descriptor: ToolLocalizedTextDescriptor | undefined = projector.projection.steps[0]?.title;
    expect(descriptor).toMatchObject({
      key: 'conversation.tool.subrunTrace.executeNamedTool',
      params: { toolName: 'removed_plugin_tool' },
    });
  });

  it('缺少正式参数时拒绝接纳，不补空对象', () => {
    const projector = createAppendOnlySubrunStepProjector(() => title('tool.read'));
    expect(() => projector.admit([{
      index: 0,
      event: createEvent('output', 'tool_output', {
        tool_name: 'read_file',
        tool_call_id: ToolCallIdSchema.parse('call-read'),
        status: 'success',
      }),
    }])).toThrow('缺少 decision/process 已接纳参数');
    expect(projector.projection.steps).toEqual([]);
  });
});
