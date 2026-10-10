import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  execution,
  ToolNode,
  ensureToolContextRuntimeCapability,
  type EngineState,
} from '@linnlabs/linnkit/runtime-kernel';
import { RunIdSchema, ToolCallIdSchema, type RuntimeEvent } from '@linnlabs/linnkit/contracts';
import { createToolContextFixture } from '@linnlabs/linnkit/testkit';
import type { ToolContext } from 'src/tools/types';
import * as builtin from '../../../plugin-registry/builtin';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../../../plugin-registry/pluginRuntimeState';
import { ToolRegistry } from '../toolRegistry';
import { defaultObservationPreviewPort } from '../defaultPorts';

beforeEach(() => {
  setPluginRuntimeStateForTests({
    installedPluginIds: ['platform'],
    enabledPluginIds: ['platform'],
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  clearPluginRuntimeStateForTests();
});

describe('registered child execution scope through ToolNode and ToolRegistry', () => {
  it('已完成的 Host 原 call ID 不能再次授权目录外调用，child 也不能继承入口例外', async () => {
    const decorate = vi.fn();
    vi.spyOn(builtin, 'getRegisteredToolContextDecorators').mockReturnValue([
      { toolNames: ['write_file'], decorate },
    ]);
    const registry = new ToolRegistry({ strictInitialization: true });
    const tool = registry.getTool('write_file');
    if (!tool) throw new Error('Formal Workspace writer is unavailable');
    const run = vi.spyOn(tool, 'run');
    const runId = RunIdSchema.parse('host-tool-scope');
    const toolCallId = ToolCallIdSchema.parse('completed-host-call');
    const context: ToolContext = createToolContextFixture({
      workingHistoryEvents: [
        {
          type: 'tool_output',
          id: 'completed-host-output',
          conversation_id: 'host-tool-scope',
          turn_id: 'host-tool-turn',
          timestamp: 1,
          version: 1,
          run_id: runId,
          tool_name: 'write_file',
          tool_call_id: toolCallId,
          status: 'success',
          observation: 'Written',
        },
      ],
      patch: {
        registeredRootAllowedTools: [],
        authorizedHostToolCall: { toolName: 'write_file', toolCallId },
      },
    });
    ensureToolContextRuntimeCapability({
      context,
      executionMeta: { runId, parentToolCallId: toolCallId },
    });
    expect(
      await registry.executeTool(
        'write_file',
        {
          locator: 'workspace:/duplicate.md',
          content: 'Duplicate',
        },
        context
      )
    ).toMatchObject({ success: false, errorCode: 'REGISTERED_ROOT_TOOL_NOT_ALLOWED' });
    context.registeredChildAllowedTools = [];
    expect(
      await registry.executeTool(
        'write_file',
        {
          locator: 'workspace:/duplicate.md',
          content: 'Duplicate',
        },
        context
      )
    ).toMatchObject({ success: false, errorCode: 'REGISTERED_CHILD_TOOL_NOT_ALLOWED' });
    expect(decorate).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('通用委派拒绝退役材料参数，且在 ToolNode start 前返回协议错误', async () => {
    const registry = new ToolRegistry({ strictInitialization: true });
    const invoke = vi.fn();
    const context: ToolContext = {
      modelId: 'test-model',
      registeredChildRunInvoker: { invoke },
    };
    const events: RuntimeEvent[] = [];
    const sequencer = new execution.EventSequencer('conversation-delegation-admission');
    const publisher = new execution.RuntimeEventPublisher(
      new execution.EventBus(sequencer.getExecutionId()),
      sequencer,
      {
        run_id: RunIdSchema.parse('delegation-admission'),
        lane: 'foreground',
        visibility: 'conversation',
      }
    );
    const state: EngineState = {
      nodeId: 'tool',
      local: {
        request: { query: 'Delegate', promptKey: 'default', availableTools: ['subagent'] },
        conversationId: 'conversation-delegation-admission',
        turnId: 'turn-delegation',
        toolContext: context,
        runtimeEventSink: (event, source) => {
          const routed = publisher.publish(event, source);
          events.push(routed);
          return routed;
        },
        pendingToolCalls: [
          {
            id: ToolCallIdSchema.parse('invalid-delegation'),
            type: 'function',
            function: {
              name: 'subagent',
              arguments: JSON.stringify({
                description: 'Read',
                prompt: 'Explain',
                input_documents: ['workspace:/source.md', 'workspace:/source.md'],
              }),
            },
          },
        ],
      },
    };
    await new ToolNode({
      toolRuntime: registry,
      observationPreview: defaultObservationPreviewPort,
    }).run(state);
    expect(events.filter(event => event.type === 'tool_process')).toHaveLength(0);
    expect(events.find(event => event.type === 'tool_output')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('Unrecognized key'),
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('伪造的正式写工具调用在 decorator 和 Workspace owner 前拒绝', async () => {
    const decorate = vi.fn();
    vi.spyOn(builtin, 'getRegisteredToolContextDecorators').mockReturnValue([
      { toolNames: ['write_file', 'edit_file'], decorate },
    ]);
    const registry = new ToolRegistry({ strictInitialization: true });
    const writeTool = registry.getTool('write_file');
    const editTool = registry.getTool('edit_file');
    if (!writeTool || !editTool) throw new Error('Formal Workspace tools are not registered');
    const write = vi.spyOn(writeTool, 'run');
    const edit = vi.spyOn(editTool, 'run');
    const context: ToolContext = { registeredChildAllowedTools: Object.freeze(['read_file']) };
    const sequencer = new execution.EventSequencer('conversation-tool-scope');
    const publisher = new execution.RuntimeEventPublisher(
      new execution.EventBus(sequencer.getExecutionId()),
      sequencer,
      {
        run_id: RunIdSchema.parse('child-tool-scope'),
        lane: 'child',
        visibility: 'parent-trace',
      }
    );
    const state: EngineState = {
      nodeId: 'tool',
      local: {
        request: {
          query: 'Read the original',
          promptKey: 'default',
          availableTools: ['read_file'],
        },
        conversationId: 'conversation-tool-scope',
        turnId: 'turn-tool-scope',
        toolContext: context,
        runtimeEventSink: (event, source) => publisher.publish(event, source),
        pendingToolCalls: [
          {
            id: ToolCallIdSchema.parse('forged-write'),
            type: 'function',
            function: {
              name: 'write_file',
              arguments: JSON.stringify({
                locator: 'workspace:/original.md',
                content: 'Overwritten',
              }),
            },
          },
          {
            id: ToolCallIdSchema.parse('forged-edit'),
            type: 'function',
            function: {
              name: 'edit_file',
              arguments: JSON.stringify({
                locator: 'workspace:/original.md',
                old_string: 'Original',
                new_string: 'Overwritten',
              }),
            },
          },
        ],
      },
    };
    await new ToolNode({
      toolRuntime: registry,
      observationPreview: defaultObservationPreviewPort,
    }).run(state);
    expect(decorate).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
    const outputs = state.local?.history?.filter(event => event.type === 'tool_output');
    expect(outputs).toHaveLength(2);
    expect(outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool_name: 'write_file',
          status: 'error',
          error: expect.stringContaining('未获准'),
        }),
        expect.objectContaining({
          tool_name: 'edit_file',
          status: 'error',
          error: expect.stringContaining('未获准'),
        }),
      ])
    );
    expect(
      await registry.executeTool(
        'write_file',
        { locator: 'workspace:/original.md', content: 'Overwritten' },
        context
      )
    ).toMatchObject({
      success: false,
      errorKind: 'execution',
      errorCode: 'REGISTERED_CHILD_TOOL_NOT_ALLOWED',
    });
  });

  it('空名单禁止全部，获准调用与没有 child scope 的现有入口保持正常', async () => {
    vi.spyOn(builtin, 'getRegisteredToolContextDecorators').mockReturnValue([]);
    const registry = new ToolRegistry({ strictInitialization: true });
    const readTool = registry.getTool('read_file');
    if (!readTool) throw new Error('Formal Workspace reader is not registered');
    const read = vi
      .spyOn(readTool, 'run')
      .mockResolvedValue(JSON.stringify({ data: {}, observation: 'Original' }));
    const denied: ToolContext = { registeredChildAllowedTools: [] };
    const allowed: ToolContext = { registeredChildAllowedTools: ['read_file'] };
    const args = { locator: 'workspace:/original.md' };
    expect(await registry.executeTool('read_file', args, denied)).toMatchObject({
      success: false,
      errorCode: 'REGISTERED_CHILD_TOOL_NOT_ALLOWED',
    });
    expect(read).not.toHaveBeenCalled();
    expect(await registry.executeTool('read_file', args, allowed)).toMatchObject({ success: true });
    expect(await registry.executeTool('read_file', args, {})).toMatchObject({ success: true });
    expect(read).toHaveBeenCalledTimes(2);
  });
});
