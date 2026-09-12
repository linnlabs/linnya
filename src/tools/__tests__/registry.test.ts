import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ToolRegistry,
  ToolRegistryInitializationError,
  ToolSchemaGenerationError,
  toolRegistry,
} from '../../app-hosts/linnya/adapters/tools/toolRegistry';
import { BaseTool, type ToolArgs, type ToolContext, type ToolParameterSchema } from '../types';
import { computeToolIdempotencyKey } from '@linnlabs/linnkit/runtime-kernel';
import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../../app-hosts/linnya/plugin-registry/pluginRuntimeState';
import * as builtinPluginRegistry from '../../app-hosts/linnya/plugin-registry/builtin';
import { createToolOutputEvent } from '@linnlabs/linnkit/contracts';
import type { ToolSchemaBuildRequest } from '@linnlabs/linnkit/runtime-kernel';

type MutableToolRegistry = {
  tools: Map<string, BaseTool>;
  initialized: boolean;
};

function mutableToolRegistry(): MutableToolRegistry {
  return toolRegistry as unknown as MutableToolRegistry;
}

function readToolSchemas(toolNames?: readonly string[]) {
  const input: ToolSchemaBuildRequest = {
    toolNames,
    invocation: { query: 'tool schema contract test', promptKey: 'default' },
  };
  return toolRegistry.getToolSchemas(input);
}

class AbortTestTool extends BaseTool {
  readonly name = 'abort_test_tool';
  readonly description = 'Abort test tool';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {},
  };

  async run(_args: ToolArgs, _context: ToolContext): Promise<string> {
    const err = new Error('The user aborted a request.');
    err.name = 'AbortError';
    throw err;
  }
}

class IdempotentConversationViewTool extends BaseTool {
  readonly name = 'idempotent_conversation_view_tool';
  readonly description = 'Idempotent conversation view tool';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      value: { type: 'string', description: 'value' },
    },
    required: ['value'],
  };
  readonly idempotency = { scope: 'conversation' } as const;

  async run(_args: ToolArgs, _context: ToolContext): Promise<string> {
    return JSON.stringify({ ok: true, fresh: true });
  }
}

class StrictAdditionalPropertiesTool extends BaseTool {
  readonly name = 'strict_additional_properties_tool';
  readonly description = 'Strict additional properties tool';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      value: { type: 'string', description: 'value' },
    },
    required: ['value'],
    additionalProperties: false,
  };

  async run(_args: ToolArgs, _context: ToolContext): Promise<string> {
    return JSON.stringify({ ok: true });
  }
}

class ArrayNormalizationTestTool extends BaseTool {
  readonly name = 'array_normalization_test_tool';
  readonly description = 'Array argument normalization test tool';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      pages: {
        type: 'array',
        description: 'page list',
        items: {
          type: 'object',
          description: 'page item',
          additionalProperties: false,
          properties: {
            title: { type: 'string', description: 'title' },
            content: { type: 'string', description: 'content' },
          },
          required: ['title', 'content'],
        },
      },
    },
    required: ['pages'],
  };

  async run(args: ToolArgs, _context: ToolContext): Promise<string> {
    return JSON.stringify({ data: { pages: args.pages } });
  }
}

class BrokenSchemaTool extends BaseTool {
  readonly name = 'broken_schema_tool';
  readonly description = 'Broken schema tool';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {},
  };

  getParametersForContext(): ToolParameterSchema {
    throw new Error('schema source unavailable');
  }

  async run(_args: ToolArgs, _context: ToolContext): Promise<string> {
    return JSON.stringify({ ok: true });
  }
}

class BrokenDescriptionTool extends BaseTool {
  readonly name = 'broken_description_tool';
  readonly description = 'Broken description tool';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {},
  };

  getDescriptionForContext(): string {
    throw new Error('description source unavailable');
  }

  async run(_args: ToolArgs, _context: ToolContext): Promise<string> {
    return JSON.stringify({ ok: true });
  }
}

class InvalidRequiredReferenceTool extends BaseTool {
  readonly name = 'invalid_required_reference_tool';
  readonly description = 'Invalid required reference tool';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {},
    required: ['missing'],
  };

  async run(_args: ToolArgs, _context: ToolContext): Promise<string> {
    return JSON.stringify({ ok: true });
  }
}

class ConstructorFailureTool extends BaseTool {
  readonly name = 'constructor_failure_tool';
  readonly description = 'Constructor failure tool';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {},
  };

  constructor() {
    super();
    throw new Error('constructor unavailable');
  }

  async run(_args: ToolArgs, _context: ToolContext): Promise<string> {
    return JSON.stringify({ ok: true });
  }
}

beforeEach(() => {
  setPluginRuntimeStateForTests({
    installedPluginIds: ['platform', 'slides'],
    enabledPluginIds: ['platform', 'slides'],
  });
  toolRegistry.reinitialize();
});

afterEach(() => {
  const mutableRegistry = mutableToolRegistry();
  mutableRegistry.tools.delete('abort_test_tool');
  mutableRegistry.tools.delete('idempotent_conversation_view_tool');
  mutableRegistry.tools.delete('strict_additional_properties_tool');
  mutableRegistry.tools.delete('array_normalization_test_tool');
  mutableRegistry.tools.delete('broken_schema_tool');
  mutableRegistry.tools.delete('broken_description_tool');
  mutableRegistry.tools.delete('invalid_required_reference_tool');
  vi.restoreAllMocks();
  toolRegistry.reinitialize();
  clearPluginRuntimeStateForTests();
});

describe('ToolRegistry.getToolSchemas', () => {
  it('所有已启用内置工具都通过正式 JSON Schema 子集门禁', () => {
    expect(() => readToolSchemas()).not.toThrow();
  });

  it('ask 向模型公开封闭的题型判别联合', () => {
    const [schema] = readToolSchemas(['ask']);

    expect(schema).toMatchObject({
      function: {
        name: 'ask',
        parameters: {
          properties: {
            questions: {
              items: {
                oneOf: [
                  { properties: { type: { enum: ['single'] } } },
                  {
                    properties: {
                      type: { enum: ['multi'] },
                      maxSelect: { minimum: 2, maximum: 7 },
                    },
                  },
                  { properties: { type: { enum: ['text'] } } },
                ],
              },
            },
          },
        },
      },
    });
  });

  it('process 通过 ToolRegistry 后仍保留七个封闭 action 分支', () => {
    const [schema] = readToolSchemas(['process']);
    const action = schema.function.parameters.properties.action;

    expect(action.oneOf).toHaveLength(7);
    expect(action.oneOf?.map(branch => branch.properties?.type.enum?.[0])).toEqual([
      'poll',
      'wait',
      'cancel',
      'write',
      'submit',
      'eof',
      'resize',
    ]);
    for (const branch of action.oneOf ?? []) {
      expect(branch.additionalProperties).toBe(false);
    }
  });

  it('read_file 向模型公开显式 locator 读取动作，不要求调用方声明图片类型', () => {
    const [schema] = readToolSchemas(['read_file']);

    expect(schema).toMatchObject({
      function: {
        name: 'read_file',
        parameters: {
          properties: {
            locator: { type: 'string' },
            view: { enum: ['text', 'document'] },
          },
        },
      },
    });
    expect(schema.function.parameters.properties).not.toHaveProperty('path');
    expect(schema.function.parameters.properties.max_chars).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 12000,
    });
    expect(JSON.stringify(schema.function.parameters)).not.toContain('"image"');
  });

  it('动态参数 schema 生成失败时应 fail-fast，而不是静默跳过工具', () => {
    const mutableRegistry = mutableToolRegistry();
    mutableRegistry.tools.set('broken_schema_tool', new BrokenSchemaTool());
    mutableRegistry.initialized = true;

    expect(() => readToolSchemas(['broken_schema_tool'])).toThrow(ToolSchemaGenerationError);
    expect(() => readToolSchemas(['broken_schema_tool'])).toThrow(/schema source unavailable/);
  });

  it('动态描述生成失败时应 fail-fast，而不是生成残缺工具目录', () => {
    const mutableRegistry = mutableToolRegistry();
    mutableRegistry.tools.set('broken_description_tool', new BrokenDescriptionTool());
    mutableRegistry.initialized = true;

    expect(() => readToolSchemas(['broken_description_tool'])).toThrow(ToolSchemaGenerationError);
    expect(() => readToolSchemas(['broken_description_tool'])).toThrow(
      /description source unavailable/
    );
  });

  it('动态目录内出现非法 required 引用时应 fail-fast', () => {
    const mutableRegistry = mutableToolRegistry();
    mutableRegistry.tools.set(
      'invalid_required_reference_tool',
      new InvalidRequiredReferenceTool()
    );
    mutableRegistry.initialized = true;

    expect(() => readToolSchemas(['invalid_required_reference_tool'])).toThrow(
      ToolSchemaGenerationError
    );
    expect(() => readToolSchemas(['invalid_required_reference_tool'])).toThrow(
      /required 引用了未声明字段: missing/
    );
  });
});

describe('ToolRegistry 初始化策略', () => {
  it('默认初始化保持 best-effort：单个工具加载失败不阻断其它工具', () => {
    vi.spyOn(builtinPluginRegistry, 'getRegisteredToolClasses').mockReturnValue([
      ConstructorFailureTool,
      IdempotentConversationViewTool,
    ]);
    vi.spyOn(builtinPluginRegistry, 'getRegisteredToolContextDecorators').mockReturnValue([]);
    const registry = new ToolRegistry();

    expect(registry.getAvailableToolNames()).toEqual(['idempotent_conversation_view_tool']);
  });

  it('strict 初始化遇到工具加载失败应 fail-fast，防止 eval 在缺工具状态下继续跑', () => {
    vi.spyOn(builtinPluginRegistry, 'getRegisteredToolClasses').mockReturnValue([
      ConstructorFailureTool,
      IdempotentConversationViewTool,
    ]);
    vi.spyOn(builtinPluginRegistry, 'getRegisteredToolContextDecorators').mockReturnValue([]);
    const registry = new ToolRegistry({ strictInitialization: true });

    expect(() => registry.getAvailableToolNames()).toThrow(ToolRegistryInitializationError);
    expect(() => registry.getAvailableToolNames()).toThrow(/constructor unavailable/);
  });
});

describe('ToolRegistry.executeTool', () => {
  it('ask owner admission 为错误题型字段返回精确问题路径', async () => {
    const result = await toolRegistry.executeTool(
      'ask',
      {
        questions: [
          {
            id: 'page_count',
            type: 'single',
            question: '希望控制在多少页？',
            options: [{ id: '12', label: '约12页' }],
            maxSelect: 2,
          },
        ],
      },
      {}
    );

    expect(result).toMatchObject({
      success: false,
      errorKind: 'protocol',
      error: 'questions[0].maxSelect: field is not allowed for this question type',
    });
  });

  it('process owner admission 将动作协议错误标记为稳定错误码', async () => {
    const result = await toolRegistry.executeTool(
      'process',
      {
        process_handle: 'command_process_123e4567-e89b-42d3-a456-426614174000',
        action: { type: 'wait' },
      },
      {},
    );

    expect(result).toMatchObject({
      success: false,
      errorKind: 'protocol',
      errorCode: 'process_protocol_violation',
    });
    expect(result.error).toContain('action.cursor：缺少必需字段');
    expect(result.error).toContain('action.wait_timeout_ms：缺少必需字段');
  });

  it('对缺失 required 参数的工具调用应直接返回 success=false，而不是伪装为成功 JSON', async () => {
    const result = await toolRegistry.executeTool('write_file', {}, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('[WRITE_FILE_ARGUMENTS_INVALID]');
    expect(result.error).toContain('content: Required');
  });

  it('对另一个缺失 required 参数的工具调用也应直接失败', async () => {
    const result = await toolRegistry.executeTool('edit_file', {}, {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('[EDIT_FILE_ARGUMENTS_INVALID]');
    expect(result.error).toContain('old_string: Required');
  });

  it('当参数是 JSON 编码的数组字符串且 schema 期望 array 时，应先归一化再执行工具', async () => {
    const mutableRegistry = mutableToolRegistry();
    mutableRegistry.tools.set('array_normalization_test_tool', new ArrayNormalizationTestTool());
    mutableRegistry.initialized = true;

    const result = await toolRegistry.executeTool(
      'array_normalization_test_tool',
      {
        pages: '[{"title":"Overview","content":"Summary"}]',
      },
      {}
    );

    expect(result.success, result.error).toBe(true);
    const parsed = JSON.parse(result.result ?? '{}');
    expect(parsed.data.pages).toEqual([
      {
        title: 'Overview',
        content: 'Summary',
      },
    ]);
  });

  it('当 schema 显式禁止 additionalProperties 时，应拒绝未知参数', async () => {
    const mutableRegistry = mutableToolRegistry();
    mutableRegistry.tools.set(
      'strict_additional_properties_tool',
      new StrictAdditionalPropertiesTool()
    );
    mutableRegistry.initialized = true;

    const result = await toolRegistry.executeTool(
      'strict_additional_properties_tool',
      { value: 'hello', extra: 'nope' },
      {}
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Additional properties not allowed: extra/i);
  });

  it('工具抛出 AbortError 时应保持中断语义向上抛出', async () => {
    const mutableRegistry = mutableToolRegistry();
    mutableRegistry.tools.set('abort_test_tool', new AbortTestTool());
    mutableRegistry.initialized = true;

    await expect(toolRegistry.executeTool('abort_test_tool', {}, {})).rejects.toMatchObject({
      name: 'AbortError',
      message: 'The user aborted a request.',
    });
  });

  it('仅提供 conversationView 时也应能命中幂等缓存', async () => {
    const tool = new IdempotentConversationViewTool();
    const runSpy = vi.spyOn(tool, 'run');
    const mutableRegistry = mutableToolRegistry();
    mutableRegistry.tools.set('idempotent_conversation_view_tool', tool);
    mutableRegistry.initialized = true;

    const cachedResult = {
      data: { ok: true, cached: true },
      observation: 'cached result',
    };
    const cachedOutput = JSON.stringify(cachedResult);
    const idempotencyKey = computeToolIdempotencyKey({
      policy: tool.idempotency,
      toolName: tool.name,
      args: { value: 'hello' },
      context: { conversationId: 'conv_1' },
    });
    const history: RuntimeEvent[] = [
      createToolOutputEvent(
        'evt_cached_1',
        'conv_1',
        'turn_1',
        'idempotent_conversation_view_tool',
        'call_cached_1',
        { status: 'success', observation: cachedResult.observation, data: cachedResult.data },
        {
          metadata: {
            idempotency: {
              key: idempotencyKey,
              cache_hit: false,
            },
          },
        }
      ),
    ];

    const result = await toolRegistry.executeTool(
      'idempotent_conversation_view_tool',
      { value: 'hello' },
      {
        conversationId: 'conv_1',
        conversationView: {
          getWorkingHistoryEvents: () => history,
          getPersistedHistoryEvents: () => history,
        },
      }
    );

    expect(result.success).toBe(true);
    expect(result.result).toBe(cachedOutput);
    expect(result.idempotency).toEqual({ key: idempotencyKey, cacheHit: true });
    expect(runSpy).not.toHaveBeenCalled();
  });
});
