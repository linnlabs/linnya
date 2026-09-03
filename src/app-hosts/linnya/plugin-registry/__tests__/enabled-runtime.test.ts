import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BaseTool, type ToolArgs, type ToolContext, type ToolParameterSchema } from 'src/tools/types';
import { PromptKeys } from 'src/app-hosts/linnya/agent-registry/prompt.types';
import { backendPluginRegistry } from '../registry';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../pluginRuntimeState';
import { toolRegistry } from 'src/app-hosts/linnya/adapters/tools/toolRegistry';
import {
  getRegisteredAgentDefinitions,
  getRegisteredBackendPluginIpcChannels,
  listRegisteredBackendPluginMetas,
} from 'src/app-hosts/linnya/plugin-registry/builtin';
import {
  allToolClasses,
  getAllToolClasses,
} from 'src/app-hosts/linnya/adapters/tools/allToolClasses';
import {
  clearRegisteredAgentTaskCache,
  getAgentTask,
} from 'src/app-hosts/linnya/agent-registry/agentTaskResolver';
import { pluginDiagnostics } from '../diagnostics';
import type { ToolSchemaBuildRequest } from 'linnkit/runtime-kernel';

class RuntimeGateTestTool extends BaseTool {
  readonly name = 'runtime_gate_test_tool';
  readonly description = 'Runtime gate test tool';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {},
  };

  async run(_args: ToolArgs, _context: ToolContext): Promise<string> {
    const context = _context as ToolContext & { runtimeGateDecorated?: boolean };
    return JSON.stringify({
      ok: true,
      decorated: context.runtimeGateDecorated === true,
    });
  }
}

class OptionalPluginTestTool extends BaseTool {
  readonly name = 'optional_plugin_test_tool';
  readonly description = 'Optional plugin gate test tool';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {},
  };

  async run(): Promise<string> {
    return JSON.stringify({ ok: true });
  }
}

const OPTIONAL_PLUGIN_ID = 'optional-runtime-test';
const OPTIONAL_PLUGIN_PROMPT_KEY = 'optional-runtime-test-agent';
const OPTIONAL_PLUGIN_SUBAGENT_TYPE = 'optional_runtime_test_subagent';
const OPTIONAL_PLUGIN_IPC_CHANNELS = ['optional-runtime:test'] as const;

type ToolSchema = ReturnType<typeof toolRegistry.getToolSchemas>[number];

function readToolSchemas(toolNames?: readonly string[]) {
  const input: ToolSchemaBuildRequest = {
    toolNames,
    invocation: { query: 'plugin runtime schema test', promptKey: 'default' },
  };
  return toolRegistry.getToolSchemas(input);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readToolSchemaEnum(schema: ToolSchema | undefined, propertyName: string): readonly unknown[] {
  const parameters = schema?.function.parameters;
  if (!isRecord(parameters) || !isRecord(parameters.properties)) {
    throw new Error(`Tool schema has no readable properties for ${schema?.function.name ?? 'unknown'}`);
  }

  const property = parameters.properties[propertyName];
  if (!isRecord(property) || !Array.isArray(property.enum)) {
    throw new Error(`Tool schema property has no enum: ${schema?.function.name ?? 'unknown'}.${propertyName}`);
  }

  return property.enum;
}

function instantiateToolNames(toolClasses: readonly (new () => BaseTool)[]): readonly string[] {
  return toolClasses.map((ToolClass) => new ToolClass().name);
}

describe('runtime enabled plugin gating', () => {
  const runtimeGateDecoratorCalls: string[] = [];

  beforeAll(() => {
    // 公共 Host 测试只验证匿名 contribution 合同，不借用任何真实插件身份。
    if (!backendPluginRegistry.has(OPTIONAL_PLUGIN_ID)) {
      backendPluginRegistry.register({
        meta: {
          id: OPTIONAL_PLUGIN_ID,
          name: 'Optional Runtime Test',
          version: '1.0.0',
          description: 'Synthetic optional plugin contribution',
          developer: 'Linnya',
          builtin: true,
          dependsOn: ['platform'],
        },
        toolClasses: [OptionalPluginTestTool],
        agentDefinitions: [{
          id: OPTIONAL_PLUGIN_PROMPT_KEY,
          promptKey: OPTIONAL_PLUGIN_PROMPT_KEY,
          defaultMode: 'agent',
          description: 'Synthetic optional plugin agent contribution',
          config: {
            enableTools: true,
            availableTools: ['optional_plugin_test_tool'],
          },
          task: {
            systemPromptBuilder: () => 'Optional plugin test prompt',
          },
        }],
        subagentTypes: [{
          type: OPTIONAL_PLUGIN_SUBAGENT_TYPE,
          promptKey: OPTIONAL_PLUGIN_PROMPT_KEY,
          description: 'Synthetic optional plugin subagent contribution',
        }],
        ipc: {
          channels: OPTIONAL_PLUGIN_IPC_CHANNELS,
          register: () => undefined,
        },
      });
    }
    backendPluginRegistry.register({
      meta: {
        id: 'runtime-gate-test',
        name: 'Runtime Gate Test',
        version: '1.0.0',
        description: 'Test-only plugin contribution',
        developer: 'Linnya',
        builtin: true,
      },
      toolClasses: [RuntimeGateTestTool],
      toolContextDecorators: [{
        toolNames: ['runtime_gate_test_tool'],
        decorate: (context, params) => {
          runtimeGateDecoratorCalls.push(params.toolName);
          (context as ToolContext & { runtimeGateDecorated?: boolean }).runtimeGateDecorated = true;
        },
      }],
      subagentTypes: [{
        type: 'runtime_gate_subagent',
        promptKey: PromptKeys.SUBAGENT_GENERAL,
        description: 'Test-only subagent contribution.',
      }],
    });
  });

  afterAll(() => {
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform'],
      enabledPluginIds: ['platform'],
    });
    toolRegistry.reinitialize();
    clearPluginRuntimeStateForTests();
    clearRegisteredAgentTaskCache();
  });

  it('only applies plugin tool context decorators when the owning plugin tool executes', async () => {
    runtimeGateDecoratorCalls.length = 0;
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', 'runtime-gate-test'],
      enabledPluginIds: ['platform'],
    });
    toolRegistry.reinitialize();

    const disabledContext: ToolContext = {};
    const disabledDecoratedContext = disabledContext as ToolContext & { runtimeGateDecorated?: boolean };
    const disabledResult = await toolRegistry.executeTool('runtime_gate_test_tool', {}, disabledContext);

    expect(disabledResult).toMatchObject({
      success: false,
      errorKind: 'protocol',
    });
    expect(runtimeGateDecoratorCalls).toEqual([]);
    expect(disabledDecoratedContext.runtimeGateDecorated).toBeUndefined();

    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', 'runtime-gate-test'],
      enabledPluginIds: ['platform', 'runtime-gate-test'],
    });
    toolRegistry.reinitialize();

    const enabledContext: ToolContext = {};
    const enabledDecoratedContext = enabledContext as ToolContext & { runtimeGateDecorated?: boolean };
    const enabledResult = await toolRegistry.executeTool('runtime_gate_test_tool', {}, enabledContext);

    expect(enabledResult.success).toBe(true);
    expect(enabledResult.result ? JSON.parse(enabledResult.result) : null).toMatchObject({
      ok: true,
      decorated: true,
    });
    expect(runtimeGateDecoratorCalls).toEqual(['runtime_gate_test_tool']);
    expect(enabledDecoratedContext.runtimeGateDecorated).toBe(true);
  });

  it('removes disabled plugin tools and subagent enum values from model-visible schemas', () => {
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', 'runtime-gate-test'],
      enabledPluginIds: ['platform'],
    });
    toolRegistry.reinitialize();

    let schemas = readToolSchemas();
    expect(schemas.some((schema) => schema.function.name === 'runtime_gate_test_tool')).toBe(false);
    expect(schemas.map((schema) => schema.function.name)).not.toContain('task');
    let subagentSchema = schemas.find((schema) => schema.function.name === 'subagent');
    expect(schemas.map((schema) => schema.function.name)).not.toContain('delegate');
    expect(readToolSchemaEnum(subagentSchema, 'subagent_type')).not.toContain('runtime_gate_subagent');

    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', 'runtime-gate-test'],
      enabledPluginIds: ['platform', 'runtime-gate-test'],
    });
    toolRegistry.reinitialize();

    schemas = readToolSchemas();
    expect(schemas.some((schema) => schema.function.name === 'runtime_gate_test_tool')).toBe(true);
    subagentSchema = schemas.find((schema) => schema.function.name === 'subagent');
    expect(readToolSchemaEnum(subagentSchema, 'subagent_type')).toContain('runtime_gate_subagent');
  });

  it('discovers an optional plugin from its registered contribution without a Host identity branch', () => {
    expect(listRegisteredBackendPluginMetas()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: OPTIONAL_PLUGIN_ID,
        name: 'Optional Runtime Test',
      }),
    ]));
  });

  it('moves optional plugin tools, agent, and subagent type behind the generic plugin gate', () => {
    pluginDiagnostics.clear();
    clearRegisteredAgentTaskCache();
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', OPTIONAL_PLUGIN_ID],
      enabledPluginIds: ['platform'],
    });
    toolRegistry.reinitialize();

    let schemas = readToolSchemas();
    expect(schemas.some((schema) => schema.function.name === 'optional_plugin_test_tool')).toBe(false);
    let subagentSchema = schemas.find((schema) => schema.function.name === 'subagent');
    expect(readToolSchemaEnum(subagentSchema, 'subagent_type')).not.toContain(OPTIONAL_PLUGIN_SUBAGENT_TYPE);
    expect(getRegisteredAgentDefinitions().some((definition) =>
      definition.promptKey === OPTIONAL_PLUGIN_PROMPT_KEY
    )).toBe(false);
    expect(() => getAgentTask(OPTIONAL_PLUGIN_PROMPT_KEY)).toThrow('未找到 promptKey');

    clearRegisteredAgentTaskCache();
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', OPTIONAL_PLUGIN_ID],
      enabledPluginIds: ['platform', OPTIONAL_PLUGIN_ID],
    });
    toolRegistry.reinitialize();

    schemas = readToolSchemas();
    expect(schemas.some((schema) => schema.function.name === 'optional_plugin_test_tool')).toBe(true);
    subagentSchema = schemas.find((schema) => schema.function.name === 'subagent');
    expect(readToolSchemaEnum(subagentSchema, 'subagent_type')).toContain(OPTIONAL_PLUGIN_SUBAGENT_TYPE);
    expect(getRegisteredAgentDefinitions().some((definition) =>
      definition.promptKey === OPTIONAL_PLUGIN_PROMPT_KEY
    )).toBe(true);
    expect(() => getAgentTask(OPTIONAL_PLUGIN_PROMPT_KEY)).not.toThrow();
  });

  it('keeps optional plugin IPC channels behind the generic plugin enabled gate', () => {
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', OPTIONAL_PLUGIN_ID],
      enabledPluginIds: ['platform'],
    });

    expect(() => getRegisteredBackendPluginIpcChannels(OPTIONAL_PLUGIN_ID))
      .toThrow(`插件未安装或未启用: ${OPTIONAL_PLUGIN_ID}`);

    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', OPTIONAL_PLUGIN_ID],
      enabledPluginIds: ['platform', OPTIONAL_PLUGIN_ID],
    });

    expect(getRegisteredBackendPluginIpcChannels(OPTIONAL_PLUGIN_ID)).toEqual([...OPTIONAL_PLUGIN_IPC_CHANNELS]);
  });

  it('keeps compatibility allToolClasses lazy and runtime-gated', () => {
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', OPTIONAL_PLUGIN_ID],
      enabledPluginIds: ['platform'],
    });

    expect(instantiateToolNames(getAllToolClasses())).not.toContain('optional_plugin_test_tool');
    expect(instantiateToolNames([...allToolClasses])).not.toContain('optional_plugin_test_tool');

    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', OPTIONAL_PLUGIN_ID],
      enabledPluginIds: ['platform', OPTIONAL_PLUGIN_ID],
    });

    expect(instantiateToolNames(getAllToolClasses())).toContain('optional_plugin_test_tool');
    expect(instantiateToolNames([...allToolClasses])).toContain('optional_plugin_test_tool');
  });

  it('does not resolve a cached plugin agent task after its owner is disabled', () => {
    pluginDiagnostics.clear();
    clearRegisteredAgentTaskCache();
    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', OPTIONAL_PLUGIN_ID],
      enabledPluginIds: ['platform', OPTIONAL_PLUGIN_ID],
    });
    toolRegistry.reinitialize();

    expect(() => getAgentTask(OPTIONAL_PLUGIN_PROMPT_KEY)).not.toThrow();

    setPluginRuntimeStateForTests({
      installedPluginIds: ['platform', OPTIONAL_PLUGIN_ID],
      enabledPluginIds: ['platform'],
    });
    toolRegistry.reinitialize();

    expect(() => getAgentTask(OPTIONAL_PLUGIN_PROMPT_KEY)).toThrow('未找到 promptKey');
    expect(pluginDiagnostics.list()).toContainEqual(
      expect.objectContaining({
        level: 'error',
        capability: 'agent',
      })
    );
  });
});
