import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubagentResultSchema } from '@app/schemas';
import { createToolContextFixture } from '@linnlabs/linnkit/testkit';
import {
  createToolOutputEvent,
  type RuntimeEvent,
  type SerializableJsonRecord,
} from '@linnlabs/linnkit/contracts';

import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { backendPluginRegistry } from 'src/app-hosts/linnya/plugin-registry/registry';
import type { PluginBackendContribution } from 'src/app-hosts/linnya/plugin-registry/types';
import type { ToolContext } from 'src/tools/types';
import { SubagentTool } from '../subagentTool';
import { derivePluginAwareToolContext } from 'src/app-hosts/linnya/plugin-registry/toolContextDerivation';
import { deriveLinnyaToolSchemaContext } from 'src/app-hosts/linnya/adapters/tools/functions/deriveLinnyaToolSchemaContext';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

function makeContext(): ToolContext {
  return createToolContextFixture({
    conversationId: 'conv_test',
    turnId: 'turn_test',
    historyEvents: [],
    patch: {
      modelId: 'model-subagent-test',
      abortSignal: new AbortController().signal,
      parentToolCallId: 'call_subagent',
      createSubRunTracePublisher: () => ({ publish: vi.fn() }),
      registeredChildRunInvoker: { invoke: invokeMock },
    },
  });
}

function successfulToolOutput(
  id: string,
  toolName: string,
  data: Record<string, unknown>,
  metadata?: SerializableJsonRecord
): RuntimeEvent {
  return createToolOutputEvent(
    id,
    'conv_test',
    'turn_test',
    toolName,
    `call_${id}`,
    { status: 'success', observation: '完成', data },
    metadata ? { metadata } : {}
  );
}

describe('SubagentTool contract', () => {
  beforeEach(() => {
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform'],
      enabledPluginIds: ['platform'],
    });
    invokeMock.mockReset();
  });

  afterEach(() => {
    clearPluginRuntimeStateForTests();
  });

  it('从启用插件 registry 动态生成 subagent_type，且 live 名称只有 subagent', () => {
    const pluginId = `subagent-contract-${crypto.randomUUID()}`;
    const contribution: PluginBackendContribution = {
      meta: {
        id: pluginId,
        name: 'Subagent Contract Test Plugin',
        version: '1.0.0',
        description: '验证动态 subagent type 聚合',
        developer: 'Linnya Test',
        builtin: false,
      },
      subagentTypes: [
        {
          type: 'test_plugin_editor',
          promptKey: 'test_plugin_editor',
          description: '测试插件贡献的编辑角色。',
        },
      ],
    };
    backendPluginRegistry.register(contribution);
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', pluginId],
      enabledPluginIds: ['platform', pluginId],
    });
    const tool = new SubagentTool();
    const subagentType = tool.getParametersForContext().properties?.subagent_type;

    expect(tool.name).toBe('subagent');
    expect(subagentType?.enum).toEqual(
      expect.arrayContaining(['general', 'document_editor', 'test_plugin_editor'])
    );
    expect(subagentType?.enum).not.toContain('deep_research_scout');
    expect(subagentType?.enum).not.toContain('deep_research_reasoner_1');
    expect(subagentType?.enum).not.toContain('deep_research_challenger');
    expect(subagentType?.enum).not.toContain('deep_research_reasoner_2');
    expect(tool.getDescriptionForContext()).not.toContain('deep_research');
    expect(subagentType?.enum).not.toContain('slides_editor');
    expect(subagentType?.enum).not.toContain('researcher');
    expect(subagentType?.enum).not.toContain('sheet_editor');
    expect(tool.description).toContain("prompt is the parent's task instruction");
    expect(tool.getParametersForContext().properties.prompt?.description).toContain(
      '项目、当前文档与文件清单由系统自动注入'
    );
  });

  it('返回严格 canonical 结果，并发布新的 subrun source 与 metadata', async () => {
    invokeMock.mockResolvedValue({
      subrunId: 'subrun_completed',
      success: true,
      finalAnswer: 'child summary',
      events: [],
      stepCount: 2,
    });

    const tool = new SubagentTool();
    const output = await tool.run({ description: '研究', prompt: '执行子任务' }, makeContext());
    const parsed = SubagentResultSchema.parse(JSON.parse(output));

    expect(parsed.data).toEqual({
      description: '研究',
      subagent_type: 'general',
      model_id: 'model-subagent-test',
      subrun_ids: ['subrun_completed'],
      status: 'completed',
      final_answer: 'child summary',
      artifacts: [],
    });
    expect(parsed.observation).toContain('final_answer=\nchild summary');
    expect(parsed.data).not.toHaveProperty('uris');
    expect(parsed.data).not.toHaveProperty('max_steps');
    expect(parsed.data).not.toHaveProperty('success');
    expect(parsed.data).not.toHaveProperty('cancelled');
    expect(tool.getExecutionSummary(output)).toBe('研究：完成。');

    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock.mock.calls[0]?.[0]).toMatchObject({
      userMessage: '研究\n\n执行子任务',
      tracePolicy: {
        source: 'tool:subagent:general',
        metadata: {
          subagent_description: '研究',
          subagent_type: 'general',
        },
      },
    });
  });

  it('只接纳 Workspace 写入和 ToolOutputStore blob，拒绝其它 Resource URI', async () => {
    invokeMock.mockResolvedValue({
      subrunId: 'subrun_artifacts',
      success: true,
      finalAnswer: '',
      stepCount: 4,
      events: [
        // 退役工具的历史子运行事件也不能被重新解释成 canonical artifact。
        successfulToolOutput('shared', 'sharedmemory_write', {
          uri: 'shared_memory://docs/notes.md',
        }),
        successfulToolOutput('evidence', 'assemble_evidence', {
          uri: 'evidence://bundles/bundle_1',
        }),
        successfulToolOutput('workspace', 'write_file', {
          inode: 'workspace:doc_123',
          path: '/Report.md',
        }),
        successfulToolOutput(
          'blob',
          'shell',
          {},
          {
            observationTruncation: {
              blobId: 'abcdef1234567890',
              originalChars: 30_000,
              previewChars: 18_000,
            },
          }
        ),
      ],
    });

    const output = await new SubagentTool().run(
      { description: '写报告', prompt: '执行子任务' },
      makeContext()
    );
    const parsed = SubagentResultSchema.parse(JSON.parse(output));

    expect(parsed.data.status).toBe('partial');
    expect(parsed.data.artifacts).toEqual([
      'workspace:doc_123',
      'tool_output://blobs/abcdef1234567890',
    ]);
    expect(parsed.observation).not.toContain('shared_memory://');
    expect(parsed.observation).not.toContain('evidence://');
  });

  it('保留既有 partial、failed 与 cancelled 终态分类', async () => {
    invokeMock
      .mockResolvedValueOnce({
        subrunId: 'subrun_partial',
        success: false,
        finalAnswer: '尚未完全验证',
        error: 'max steps exceeded',
        events: [],
        stepCount: 60,
      })
      .mockResolvedValueOnce({
        subrunId: 'subrun_failed',
        success: false,
        finalAnswer: '',
        error: 'child failed',
        events: [],
        stepCount: 1,
      })
      .mockResolvedValueOnce({
        subrunId: 'subrun_cancelled',
        success: false,
        cancelled: true,
        finalAnswer: '',
        error: 'user cancelled',
        events: [],
        stepCount: 1,
      });

    const tool = new SubagentTool();
    const partial = SubagentResultSchema.parse(
      JSON.parse(await tool.run({ description: '部分任务', prompt: '执行' }, makeContext()))
    );
    const failed = SubagentResultSchema.parse(
      JSON.parse(await tool.run({ description: '失败任务', prompt: '执行' }, makeContext()))
    );
    const cancelled = SubagentResultSchema.parse(
      JSON.parse(await tool.run({ description: '取消任务', prompt: '执行' }, makeContext()))
    );

    expect(partial.data.status).toBe('partial');
    expect(failed.data.status).toBe('failed');
    expect(cancelled.data.status).toBe('cancelled');
    expect(tool.getExecutionSummary(JSON.stringify(cancelled))).toBe('取消任务：已取消。');
  });

  it('显式传入已隔离的 beta subagent_type 时在 child 启动前失败', async () => {
    await expect(
      new SubagentTool().run(
        {
          description: '研究任务',
          prompt: '执行任务',
          subagent_type: 'deep_research_scout',
        },
        makeContext()
      )
    ).rejects.toThrow('subagent: unknown subagent_type "deep_research_scout"; available types:');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('模型目录与执行共用调用者准入，未声明保持公开，空名单拒绝且参数不能伪造身份', async () => {
    const pluginId = `subagent-scope-${crypto.randomUUID()}`;
    backendPluginRegistry.register({
      meta: {
        id: pluginId,
        name: 'Scope fixture',
        version: '1.0.0',
        description: 'Caller scope',
        developer: 'Test',
        builtin: false,
      },
      subagentTypes: [
        {
          type: 'scoped_reviewer',
          promptKey: 'scoped_reviewer',
          description: 'Scoped reviewer',
          allowedCallerAgentIds: ['admitted_parent'],
        },
        {
          type: 'disabled_reviewer',
          promptKey: 'disabled_reviewer',
          description: 'Disabled reviewer',
          allowedCallerAgentIds: [],
        },
      ],
    });
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', pluginId],
      enabledPluginIds: ['platform', pluginId],
    });
    const tool = new SubagentTool();
    const scope = (callerAgentId?: string) => {
      const invocation = { query: 'Delegate', promptKey: 'default', callerAgentId };
      return deriveLinnyaToolSchemaContext(invocation);
    };
    const types = (callerAgentId?: string) =>
      tool.getParametersForContext(scope(callerAgentId)).properties.subagent_type.enum;
    expect(types()).not.toContain('scoped_reviewer');
    expect(types('other_parent')).not.toContain('scoped_reviewer');
    expect(types('admitted_parent')).toContain('scoped_reviewer');
    expect(types('admitted_parent')).not.toContain('disabled_reviewer');
    expect(tool.getDescriptionForContext(scope('admitted_parent'))).toContain('Scoped reviewer');
    expect(tool.getDescriptionForContext(scope('other_parent'))).not.toContain('Scoped reviewer');
    const args = {
      description: 'Review',
      prompt: 'Check evidence',
      subagent_type: 'scoped_reviewer',
    };
    await expect(tool.run(args, makeContext())).rejects.toThrow('unknown subagent_type');
    await expect(
      tool.run({ ...args, callerAgentId: 'admitted_parent' }, makeContext())
    ).rejects.toThrow('Unrecognized key');
    const admitted = derivePluginAwareToolContext(makeContext(), {
      callerAgentId: 'admitted_parent',
      availableSubagentTypes: ['scoped_reviewer', 'disabled_reviewer'],
    });
    const admittedSchema = tool.getParametersForContext(admitted);
    expect(admittedSchema.properties.subagent_type.enum).toEqual(['scoped_reviewer']);
    expect(admittedSchema.required).toContain('subagent_type');
    expect(tool.getDescriptionForContext(admitted)).not.toContain('**general**');
    expect(tool.isAvailableForContext({ availableSubagentTypes: [] })).toBe(false);
    await expect(tool.run({ ...args, subagent_type: 'general' }, admitted)).rejects.toThrow(
      'unknown subagent_type'
    );
    await expect(
      tool.run({ description: 'Missing type', prompt: 'Delegate' }, admitted)
    ).rejects.toThrow('subagent_type is required for this caller');
    await expect(
      tool.run(args, derivePluginAwareToolContext(admitted, { availableSubagentTypes: [] }))
    ).rejects.toThrow('unknown subagent_type');
    await expect(
      tool.run(args, derivePluginAwareToolContext(admitted, { callerAgentId: 'other_parent' }))
    ).rejects.toThrow('unknown subagent_type');
    await expect(
      tool.run({ ...args, subagent_type: 'disabled_reviewer' }, admitted)
    ).rejects.toThrow('unknown subagent_type');
    expect(invokeMock).not.toHaveBeenCalled();
    invokeMock.mockResolvedValue({
      subrunId: 'scoped-child',
      success: true,
      finalAnswer: 'Reviewed',
      events: [],
      stepCount: 1,
    });
    await expect(tool.run(args, admitted)).resolves.toContain('Reviewed');
  });

  it('显式材料通过正式参数校验并交接给普通 child，旧参数仍保持原请求', async () => {
    const tool = new SubagentTool();
    const args = { description: 'Read', prompt: 'Explain' };
    for (const input_documents of [
      [],
      ['file:///source.md'],
      ['workspace:/source.md', 'workspace:/source.md'],
    ]) {
      await expect(tool.run({ ...args, input_documents }, makeContext())).rejects.toThrow();
    }
    expect(invokeMock).not.toHaveBeenCalled();
    invokeMock.mockResolvedValue({
      subrunId: 'material-child',
      success: true,
      finalAnswer: 'Read',
      events: [],
      stepCount: 1,
    });
    await tool.run({ ...args, input_documents: ['workspace:/source.md'] }, makeContext());
    expect(invokeMock.mock.calls[0]?.[0].userMessage).toBe(
      'Read\n\nExplain\n\nInput documents:\nworkspace:/source.md'
    );
  });

  it('Host 只准备与接纳，真实 child 仍经统一 runner，正式产物合并去重', async () => {
    const context = makeContext();
    const acceptResult = vi.fn(async () => [
      'workspace:owner-document',
      'workspace:generic-document',
    ]);
    context.prepareSubagentTask = vi.fn(async request => {
      expect(request).toMatchObject({
        args: { input_documents: ['workspace:/source.md'] },
        resolvedType: { type: 'general', promptKey: 'subagent_general', inheritTurns: 0 },
        modelId: 'model-subagent-test',
      });
      return {
        context: derivePluginAwareToolContext(context, { userQuery: 'Host-bound task' }),
        userMessage: 'Frozen Host request',
        subrunId: 'bound-child',
        acceptResult,
      };
    });
    invokeMock.mockResolvedValue({
      subrunId: 'bound-child',
      success: true,
      finalAnswer: 'Saved',
      stepCount: 1,
      events: [
        successfulToolOutput('generic', 'write_file', { inode: 'workspace:generic-document' }),
      ],
    });
    const output = await new SubagentTool().run(
      {
        description: 'Task',
        prompt: 'Parent instruction',
        input_documents: ['workspace:/source.md'],
      },
      context
    );
    expect(SubagentResultSchema.parse(JSON.parse(output)).data.artifacts).toEqual([
      'workspace:generic-document',
      'workspace:owner-document',
    ]);
    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock.mock.calls[0]?.[0]).toMatchObject({
      userMessage: 'Frozen Host request',
      tracePolicy: { subrunId: 'bound-child' },
    });
    expect(acceptResult).toHaveBeenCalledOnce();
  });

  it('Host 准备和产物接纳失败均不伪报成功，失败或取消 child 不接纳产物', async () => {
    const context = makeContext();
    const tool = new SubagentTool();
    const args = { description: 'Task', prompt: 'Parent instruction' };
    context.prepareSubagentTask = async () => {
      throw new Error('Input changed');
    };
    await expect(tool.run(args, context)).rejects.toThrow('Input changed');
    expect(invokeMock).not.toHaveBeenCalled();
    const acceptResult = vi.fn(async (): Promise<readonly string[]> => {
      throw new Error('Output rejected');
    });
    context.prepareSubagentTask = async () => ({ context, userMessage: 'Bound', acceptResult });
    invokeMock.mockResolvedValue({
      subrunId: 'bound',
      success: true,
      finalAnswer: 'Claimed done',
      events: [],
      stepCount: 1,
    });
    await expect(tool.run(args, context)).rejects.toThrow('Output rejected');
    expect(acceptResult).toHaveBeenCalledOnce();
    for (const cancelled of [false, true]) {
      invokeMock.mockResolvedValue({
        subrunId: 'bound',
        success: false,
        cancelled,
        error: 'Stopped',
        finalAnswer: '',
        events: [],
        stepCount: 1,
      });
      const output = SubagentResultSchema.parse(JSON.parse(await tool.run(args, context)));
      expect(output.data.status).toBe(cancelled ? 'cancelled' : 'failed');
    }
    expect(acceptResult).toHaveBeenCalledOnce();
  });
});
