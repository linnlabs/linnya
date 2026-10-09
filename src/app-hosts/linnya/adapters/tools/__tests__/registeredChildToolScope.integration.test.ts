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
import { RESEARCH_AGENT_ID } from '@app/schemas';
import { freezeAgentRunInput } from '../../../agent-registry/freezeAgentRunInput';
import { resolveAgentRequestAdmission } from '../../../agent-registry/resolveAgentRequestAdmission';

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

  it('真实平台研究角色仅进入研究父目录，Default 既不可见也无法执行', async () => {
    const registry = new ToolRegistry({ strictInitialization: true });
    const research = freezeAgentRunInput(
      resolveAgentRequestAdmission(
        {
          query: 'Explain the evidence',
          promptKey: RESEARCH_AGENT_ID,
          project_metadata: { id: 'delegation-scope-project' },
        },
        { history: [] }
      )
    );
    const roles = registry.getToolSchemas({ invocation: research, toolNames: ['subagent'] })[0]
      ?.function.parameters.properties.subagent_type.enum;
    expect(roles).toEqual(research.availableSubagentTypes);
    expect(roles).toHaveLength(6);
    expect(roles).not.toContain('general');
    expect(roles).not.toContain('document_editor');
    if (!roles) throw new Error('Research role catalog is unavailable');
    const invoke = vi.fn();
    const invocation = freezeAgentRunInput({
      query: 'An ordinary task',
      promptKey: 'default',
      callerAgentId: RESEARCH_AGENT_ID,
      availableSubagentTypes: roles,
    });
    expect(invocation.callerAgentId).not.toBe(RESEARCH_AGENT_ID);
    expect(invocation.availableSubagentTypes).toBeUndefined();
    const schema = registry.getToolSchemas({ invocation, toolNames: ['subagent'] })[0];
    expect(schema?.function.parameters.properties.subagent_type.enum).toEqual([
      'general',
      'document_editor',
    ]);
    for (const type of roles) {
      expect(schema?.function.description).not.toContain(`**${type}**`);
      const context: ToolContext = {
        callerAgentId: invocation.callerAgentId,
        availableSubagentTypes: invocation.availableSubagentTypes,
        modelId: 'scope-test-model',
        registeredChildRunInvoker: { invoke },
      };
      const result = await registry.executeTool(
        'subagent',
        {
          description: 'Unauthorized role',
          prompt: 'Delegate',
          subagent_type: type,
        },
        context
      );
      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('unknown subagent_type'),
      });
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it('subagent 目录与执行按 Host 调用者收窄，非法材料在 ToolNode start 前拒绝', async () => {
    vi.spyOn(builtin, 'getRegisteredSubagentTypes').mockReturnValue([
      { type: 'general', promptKey: 'subagent_general', description: 'Public worker' },
      {
        type: 'scoped',
        promptKey: 'scoped_worker',
        description: 'Scoped worker',
        allowedCallerAgentIds: ['allowed-caller'],
      },
    ]);
    const registry = new ToolRegistry({ strictInitialization: true });
    const invocation = { query: 'Delegate', promptKey: 'default', callerAgentId: 'allowed-caller' };
    const admitted = registry.getToolSchemas({ invocation, toolNames: ['subagent'] });
    expect(admitted[0]?.function.parameters.properties.subagent_type.enum).toEqual([
      'general',
      'scoped',
    ]);
    const narrowedInvocation = { ...invocation, availableSubagentTypes: ['scoped'] };
    const narrowed = registry.getToolSchemas({
      invocation: narrowedInvocation,
      toolNames: ['subagent'],
    });
    expect(narrowed[0]?.function.parameters.properties.subagent_type.enum).toEqual(['scoped']);
    expect(narrowed[0]?.function.parameters.required).toContain('subagent_type');
    for (const restricted of [
      { ...narrowedInvocation, availableSubagentTypes: [] },
      { ...narrowedInvocation, callerAgentId: 'other' },
    ]) {
      expect(registry.getToolSchemas({ invocation: restricted, toolNames: ['subagent'] })).toEqual(
        []
      );
    }
    const otherInvocation = { ...invocation, callerAgentId: 'other' };
    expect(
      registry.getToolSchemas({ invocation: otherInvocation, toolNames: ['subagent'] })[0]?.function
        .parameters.properties.subagent_type.enum
    ).toEqual(['general']);
    const invoke = vi.fn();
    const context: ToolContext = {
      callerAgentId: 'other',
      modelId: 'test-model',
      registeredChildRunInvoker: { invoke },
    };
    expect(
      await registry.executeTool(
        'subagent',
        { description: 'Delegate', prompt: 'Read', subagent_type: 'scoped' },
        context
      )
    ).toMatchObject({ success: false });
    expect(invoke).not.toHaveBeenCalled();

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
      error: expect.stringContaining('input_documents.1'),
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
