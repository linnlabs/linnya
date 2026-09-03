import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestTickPipelineContext } from '../__tests__/createTestTickPipelineContext';
import { runTickPipeline } from '../runTickPipeline';
import type { TickStage } from '../types';
import type { FunctionToolSchema } from '../../../tools/toolContracts';

const getModelByIdMock = vi.fn();

function createContext() {
  return createTestTickPipelineContext({
    request: {
      model_id: 'requested-model',
      enableTools: true,
      availableTools: ['tool_a'],
    },
    context: {
      executorLocal: { stepCount: 1 },
      conversationId: 'conv_prepare_call',
      turnId: 'turn_prepare_call',
    },
  });
}

async function runStage(ctx: ReturnType<typeof createContext>, stage: TickStage): Promise<void> {
  await runTickPipeline(ctx, [stage]);
}

describe('createPrepareCallStage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getModelByIdMock.mockReturnValue(undefined);
  });

  it('通过 ModelResolver 解析模型，不再依赖 LlmCaller', async () => {
    const { createPrepareCallStage } = await import('./prepareCallStage');
    const ctx = createContext();
    const modelResolver = {
      resolveModelId: vi.fn(() => 'resolved-model'),
    };
    const toolCatalog = {
      getToolSchemas: vi.fn(() => []),
      getToolDefinition: vi.fn(() => undefined),
    };

    const stage = createPrepareCallStage({
      modelResolver,
      modelCatalog: { getModelById: getModelByIdMock },
      toolCatalog,
    });

    await runStage(ctx, stage);

    expect(modelResolver.resolveModelId).toHaveBeenCalledWith('requested-model');
    expect(toolCatalog.getToolSchemas).toHaveBeenCalledWith({
      toolNames: ctx.request.availableTools,
      invocation: ctx.request,
    });
    expect(ctx.modelId).toBe('resolved-model');
  });

  it('只从当前暴露工具的通用 definition 派生流式生命周期 policy', async () => {
    const { createPrepareCallStage } = await import('./prepareCallStage');
    const ctx = createContext();
    const stage = createPrepareCallStage({
      modelResolver: { resolveModelId: vi.fn(() => 'resolved-model') },
      modelCatalog: { getModelById: getModelByIdMock },
      toolCatalog: {
        getToolSchemas: vi.fn((): FunctionToolSchema[] => [
          {
            type: 'function' as const,
            function: {
              name: 'preview_tool',
              description: 'preview',
              parameters: { type: 'object', properties: {} },
            },
          },
        ]),
        getToolDefinition: vi.fn(() => ({
          parameters: { type: 'object' as const, properties: {} },
          streaming: { emitPlaceholder: true as const },
        })),
      },
    });

    await runStage(ctx, stage);

    expect(ctx.toolCallStreamingPolicies).toEqual({
      preview_tool: { emitPlaceholder: true },
    });
  });

  it('用当前模型的 tokenizer 估算最终 Tool definitions，并写入独立预算项', async () => {
    const { createPrepareCallStage } = await import('./prepareCallStage');
    const ctx = createContext();
    const estimateText = vi.fn(() => 137);
    ctx.tokenizer = {
      estimateText,
      estimateMessage: vi.fn(() => 0),
    };
    const stage = createPrepareCallStage({
      modelResolver: { resolveModelId: vi.fn(() => 'resolved-model') },
      modelCatalog: { getModelById: getModelByIdMock },
      toolCatalog: {
        getToolSchemas: vi.fn((): FunctionToolSchema[] => [
          {
            type: 'function',
            function: {
              name: 'preview_tool',
              description: 'preview',
              parameters: { type: 'object', properties: {} },
            },
          },
        ]),
        getToolDefinition: vi.fn(() => ({
          parameters: { type: 'object' as const, properties: {} },
        })),
      },
    });

    await runStage(ctx, stage);

    expect(ctx.toolDefinitionTokens).toBe(137);
    expect(estimateText).toHaveBeenCalledWith(
      JSON.stringify({
        tools: [
          {
            name: 'preview_tool',
            description: 'preview',
            parameters: { type: 'object', properties: {} },
          },
        ],
        tool_choice: 'auto',
      }),
      'resolved-model'
    );
  });

  it('run 内续跑时，cloud 模型应附加 quota fallback 选项', async () => {
    const { createPrepareCallStage } = await import('./prepareCallStage');
    const ctx = createContext();
    ctx.executorLocal = {
      stepCount: 1,
      llmInvocationKind: 'continuation',
      runLockedModelId: 'locked-model',
    };
    const modelResolver = {
      resolveModelId: vi.fn(() => 'locked-model'),
    };
    const toolCatalog = {
      getToolSchemas: vi.fn(() => []),
      getToolDefinition: vi.fn(() => undefined),
    };

    getModelByIdMock.mockReturnValue({
      id: 'locked-model',
      billing_mode: 'cloud',
    });

    const stage = createPrepareCallStage({
      modelResolver,
      modelCatalog: { getModelById: getModelByIdMock },
      toolCatalog,
      cloudQuotaFallbackModelId: 'cloud-deepseek-reasoner',
    });

    await runStage(ctx, stage);

    expect(modelResolver.resolveModelId).toHaveBeenCalledWith('locked-model');
    expect(ctx.llmOptions.cloud_quota_fallback_model_id).toBe('cloud-deepseek-reasoner');
  });

  it('用户发起的首次 LLM 调用不应设置 quota fallback', async () => {
    const { createPrepareCallStage } = await import('./prepareCallStage');
    const ctx = createContext();
    ctx.executorLocal = {
      stepCount: 1,
      llmInvocationKind: 'user_initiated',
      runLockedModelId: 'locked-model',
    };
    const modelResolver = {
      resolveModelId: vi.fn(() => 'locked-model'),
    };
    const toolCatalog = {
      getToolSchemas: vi.fn(() => []),
      getToolDefinition: vi.fn(() => undefined),
    };

    getModelByIdMock.mockReturnValue({
      id: 'locked-model',
      billing_mode: 'cloud',
    });

    const stage = createPrepareCallStage({
      modelResolver,
      modelCatalog: { getModelById: getModelByIdMock },
      toolCatalog,
      cloudQuotaFallbackModelId: 'cloud-deepseek-reasoner',
    });

    await runStage(ctx, stage);

    expect(ctx.llmOptions.cloud_quota_fallback_model_id).toBeUndefined();
  });

  it('没有显式 llmInvocationKind 时不应用 stepCount 推断 quota fallback', async () => {
    const { createPrepareCallStage } = await import('./prepareCallStage');
    const ctx = createContext();
    ctx.executorLocal = {
      stepCount: 3,
      runLockedModelId: 'locked-model',
    };
    const modelResolver = {
      resolveModelId: vi.fn(() => 'locked-model'),
    };
    const toolCatalog = {
      getToolSchemas: vi.fn(() => []),
      getToolDefinition: vi.fn(() => undefined),
    };

    getModelByIdMock.mockReturnValue({
      id: 'locked-model',
      billing_mode: 'cloud',
    });

    const stage = createPrepareCallStage({
      modelResolver,
      modelCatalog: { getModelById: getModelByIdMock },
      toolCatalog,
      cloudQuotaFallbackModelId: 'cloud-deepseek-reasoner',
    });

    await runStage(ctx, stage);

    expect(ctx.llmOptions.cloud_quota_fallback_model_id).toBeUndefined();
  });

  it('固定模型运行时约束应禁止模型 fallback，并且不注入 quota fallback 目标', async () => {
    const { createPrepareCallStage } = await import('./prepareCallStage');
    const ctx = createContext();
    ctx.executorLocal = {
      stepCount: 3,
      llmInvocationKind: 'continuation',
      lockRequestedModelId: true,
    };
    const modelResolver = {
      resolveModelId: vi.fn(() => 'cloud-primary-model'),
    };
    const toolCatalog = {
      getToolSchemas: vi.fn(() => []),
      getToolDefinition: vi.fn(() => undefined),
    };

    getModelByIdMock.mockReturnValue({
      id: 'cloud-primary-model',
      billing_mode: 'cloud',
    });

    const stage = createPrepareCallStage({
      modelResolver,
      modelCatalog: { getModelById: getModelByIdMock },
      toolCatalog,
      cloudQuotaFallbackModelId: 'cloud-deepseek-reasoner',
    });

    await runStage(ctx, stage);

    expect(ctx.llmOptions.allow_model_fallback).toBe(false);
    expect(ctx.llmOptions.cloud_quota_fallback_model_id).toBeUndefined();
  });

  it('应把用户 reasoning_effort 降级后写入 llmOptions', async () => {
    const { createPrepareCallStage } = await import('./prepareCallStage');
    const ctx = createContext();
    ctx.request.reasoning_effort = 'xhigh';
    const modelResolver = {
      resolveModelId: vi.fn(() => 'resolved-model'),
    };
    const toolCatalog = {
      getToolSchemas: vi.fn(() => []),
      getToolDefinition: vi.fn(() => undefined),
    };

    getModelByIdMock.mockReturnValue({
      id: 'resolved-model',
      reasoning: {
        supported_efforts: ['low', 'medium', 'high'],
        default_effort: 'medium',
      },
    });

    const stage = createPrepareCallStage({
      modelResolver,
      modelCatalog: { getModelById: getModelByIdMock },
      toolCatalog,
    });

    await runStage(ctx, stage);

    expect(ctx.llmOptions.reasoning_effort).toBe('high');
  });

  it('模型无 reasoning 契约时不写 llmOptions.reasoning_effort', async () => {
    const { createPrepareCallStage } = await import('./prepareCallStage');
    const ctx = createContext();
    ctx.request.reasoning_effort = 'high';
    const modelResolver = {
      resolveModelId: vi.fn(() => 'resolved-model'),
    };
    const toolCatalog = {
      getToolSchemas: vi.fn(() => []),
      getToolDefinition: vi.fn(() => undefined),
    };

    getModelByIdMock.mockReturnValue({ id: 'resolved-model' });

    const stage = createPrepareCallStage({
      modelResolver,
      modelCatalog: { getModelById: getModelByIdMock },
      toolCatalog,
    });

    await runStage(ctx, stage);

    expect(ctx.llmOptions.reasoning_effort).toBeUndefined();
  });

  it('只向当前模型暴露兼容的静态图片工具，并聚合实际暴露工具 requirement', async () => {
    const { createPrepareCallStage } = await import('./prepareCallStage');
    const ctx = createContext();
    const textSchema: FunctionToolSchema = {
      type: 'function',
      function: {
        name: 'text_tool',
        description: 'text',
        parameters: { type: 'object', properties: {} },
      },
    };
    const imageSchema: FunctionToolSchema = {
      type: 'function',
      function: {
        name: 'image_tool',
        description: 'image',
        parameters: { type: 'object', properties: {} },
      },
    };
    const getToolDefinition = vi.fn((toolName: string) => ({
      parameters: { type: 'object' as const, properties: {} },
      ...(toolName === 'image_tool'
        ? {
            modelInputRequirement: {
              requires_image_input: true,
              placements: ['tool_result_image'] as const,
            },
          }
        : {}),
    }));
    getModelByIdMock.mockReturnValue({
      id: 'resolved-model',
      enabled: true,
      capabilities: ['chat', 'image_input'],
      adapter_input_support: { user_image: true, tool_result_image: false },
    });
    const stage = createPrepareCallStage({
      modelResolver: { resolveModelId: vi.fn(() => 'resolved-model') },
      modelCatalog: { getModelById: getModelByIdMock },
      toolCatalog: {
        getToolSchemas: vi.fn(() => [textSchema, imageSchema]),
        getToolDefinition,
      },
    });

    await runStage(ctx, stage);

    expect(ctx.toolSchemas.map(schema => schema.function.name)).toEqual(['text_tool']);
    expect(ctx.toolModelInputRequirement).toEqual({
      requires_image_input: false,
      placements: [],
    });
  });

  it('非视觉模型仍可见 when_supported 图片结果工具且初始请求不携带图片 requirement', async () => {
    const { createPrepareCallStage } = await import('./prepareCallStage');
    const ctx = createContext();
    const imageSchema: FunctionToolSchema = {
      type: 'function',
      function: {
        name: 'generate_image',
        description: 'generate image',
        parameters: { type: 'object', properties: {} },
      },
    };
    getModelByIdMock.mockReturnValue({
      id: 'text-model',
      enabled: true,
      capabilities: ['chat'],
      adapter_input_support: { user_image: false, tool_result_image: false },
    });
    const stage = createPrepareCallStage({
      modelResolver: { resolveModelId: vi.fn(() => 'text-model') },
      modelCatalog: { getModelById: getModelByIdMock },
      toolCatalog: {
        getToolSchemas: vi.fn(() => [imageSchema]),
        getToolDefinition: vi.fn(() => ({
          parameters: { type: 'object' as const, properties: {} },
          modelInputRequirement: {
            requires_image_input: true,
            placements: ['tool_result_image'] as const,
          },
          modelInputDelivery: 'when_supported' as const,
        })),
      },
    });

    await runStage(ctx, stage);

    expect(ctx.toolSchemas.map(schema => schema.function.name)).toEqual(['generate_image']);
    expect(ctx.toolModelInputRequirement).toEqual({
      requires_image_input: false,
      placements: [],
    });
  });

  it('兼容模型保留静态图片工具，动态工具未声明 requirement 时不被整体隐藏', async () => {
    const { createPrepareCallStage } = await import('./prepareCallStage');
    const ctx = createContext();
    const schemas: FunctionToolSchema[] = ['resource_read', 'image_tool'].map(name => ({
      type: 'function',
      function: {
        name,
        description: name,
        parameters: { type: 'object', properties: {} },
      },
    }));
    getModelByIdMock.mockReturnValue({
      id: 'resolved-model',
      enabled: true,
      capabilities: ['chat', 'image_input'],
      adapter_input_support: { user_image: true, tool_result_image: true },
    });
    const stage = createPrepareCallStage({
      modelResolver: { resolveModelId: vi.fn(() => 'resolved-model') },
      modelCatalog: { getModelById: getModelByIdMock },
      toolCatalog: {
        getToolSchemas: vi.fn(() => schemas),
        getToolDefinition: vi.fn((toolName: string) => ({
          parameters: { type: 'object' as const, properties: {} },
          ...(toolName === 'image_tool'
            ? {
                modelInputRequirement: {
                  requires_image_input: true,
                  placements: ['tool_result_image'] as const,
                },
              }
            : {}),
        })),
      },
    });

    await runStage(ctx, stage);

    expect(ctx.toolSchemas.map(schema => schema.function.name)).toEqual([
      'resource_read',
      'image_tool',
    ]);
    expect(ctx.toolModelInputRequirement).toEqual({
      requires_image_input: true,
      placements: ['tool_result_image'],
    });
  });
});
