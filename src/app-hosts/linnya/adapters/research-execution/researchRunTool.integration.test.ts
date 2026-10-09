import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResearchRunDataSchema } from '@app/schemas';
import { AGENT_DEFINITION } from '../../agent-registry/agents/default';
import * as builtin from '../../plugin-registry/builtin';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../../plugin-registry/pluginRuntimeState';
import { ToolRegistry, ToolRegistryInitializationError } from '../tools/toolRegistry';
import type { ToolContext } from 'src/tools/types';
import { ResearchRunTool } from './ResearchRunTool';

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

describe('Host research tool catalogue and result boundary', () => {
  it('模型的完整与显式工具目录都隐藏研究入口，Default 原有工具目录不变', () => {
    const registry = new ToolRegistry({ strictInitialization: true });
    const invocation = { query: 'Research admission', promptKey: 'default' };
    expect(registry.getToolSchemas({ invocation }).map(item => item.function.name)).not.toContain(
      'research_run'
    );
    expect(
      registry
        .getToolSchemas({ invocation, toolNames: ['research_run', 'read_file'] })
        .map(item => item.function.name)
    ).toEqual(['read_file']);
    expect(registry.getAvailableToolNames()).not.toContain('research_run');
    expect(registry.getAvailableToolNames(['research_run', 'read_file'])).toEqual(['read_file']);

    const defaultNames = AGENT_DEFINITION.config.availableTools;
    expect(
      registry
        .getToolSchemas({ invocation, toolNames: defaultNames })
        .map(item => item.function.name)
    ).toEqual(defaultNames);
    expect(registry.getTool('research_run')).toBeInstanceOf(ResearchRunTool);
    expect(registry.getToolDefinition('research_run')).toBeDefined();
  });

  it('Host 专用名单拼错时拒绝装配，不能悄悄变成模型可见工具', () => {
    vi.spyOn(builtin, 'getRegisteredHostOnlyToolNames').mockReturnValue(['unregistered_host_tool']);
    const registry = new ToolRegistry();
    expect(() =>
      registry.getToolSchemas({
        invocation: { query: 'Research admission', promptKey: 'default' },
      })
    ).toThrow(ToolRegistryInitializationError);
    expect(() => registry.getTool('research_run')).toThrow('Host-only 工具未注册');
  });

  it.each([0, 1])('Host 仍可执行隐藏入口，输入变化时如实报告 %i 份已保存产物', async count => {
    const artifacts =
      count === 0
        ? []
        : [
            {
              stage: 'investigation',
              subrun_id: 'research-investigation',
              path: 'workspace:/investigation.md',
              inode: 'workspace:investigation',
              sha256: 'a'.repeat(64),
              citation_sha256: 'b'.repeat(64),
            },
          ];
    const data = ResearchRunDataSchema.parse({
      status: 'inputs_changed',
      model_id: 'fixture-model',
      subrun_ids: artifacts.map(item => item.subrun_id),
      artifacts,
      changed_paths: ['workspace:/source.md'],
    });
    // 此处只隔离用例接纳，执行仍走真实 registry 与工具；durable admission 另由 Flow 集成测试覆盖。
    vi.spyOn(builtin, 'getRegisteredToolContextDecorators').mockReturnValue([]);
    const context: ToolContext = { researchExecution: vi.fn().mockResolvedValue(data) };
    const registry = new ToolRegistry({ strictInitialization: true });
    const result = await registry.executeTool(
      'research_run',
      {
        question: 'Explain the evidence',
        reader: 'General reader',
        task_type: 'fixed',
        materials: ['workspace:/source.md'],
      },
      context
    );
    expect(result.success).toBe(true);
    if (typeof result.result !== 'string') throw new Error('Missing structured tool result');
    const output: unknown = JSON.parse(result.result);
    const retained = count === 0 ? '尚未保存研究产物' : '已保存的 1 份研究产物仍绑定原输入版本';
    expect(output).toMatchObject({
      data,
      observation: expect.stringContaining(retained),
      control: { terminateRun: true, finalAnswer: expect.stringContaining(retained) },
    });
    if (count === 0) expect(result.result).not.toContain('已保留候选稿');
  });
});
