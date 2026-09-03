import { describe, expect, it, vi } from 'vitest';
import {
  createToolOutputEvent,
  type RuntimeEvent,
  type RuntimeResourceRef,
  ToolCallIdSchema,
} from '../../../../contracts';
import { computeToolIdempotencyKey } from '../../../tools/idempotency/toolIdempotency';
import type {
  ToolExecutionPort,
  ToolExecutionResult,
  ToolRuntimeDefinition,
} from '../../../tools/ports';
import type { EngineState } from '../../types';
import { ToolNode } from '../toolNode';
import { createRuntimeEventAdmissionSink } from './runtimeEventAdmissionFixture';

const imageRef: RuntimeResourceRef = {
  id: 'selection-1',
  kind: 'image',
  resourceId: 'asset-1',
  mediaType: 'image/png',
  byteLength: 128,
  width: 16,
  height: 8,
  sha256: 'a'.repeat(64),
};

const secondImageRef: RuntimeResourceRef = {
  id: 'selection-2',
  kind: 'image',
  resourceId: 'asset-2',
  mediaType: 'image/webp',
  byteLength: 256,
  width: 8,
  height: 16,
  sha256: 'b'.repeat(64),
};

const resolvedAttachments: RuntimeResourceRef[] = [imageRef, secondImageRef];

const structuredOutput = JSON.stringify({
  data: { uri: 'asset://assets/asset-1' },
  observation: 'image loaded',
  modelInput: {
    attachments: [
      { id: 'selection-1', uri: 'asset://assets/asset-1' },
      { id: 'selection-2', uri: 'asset://assets/asset-2' },
    ],
  },
});

function buildState(history: RuntimeEvent[] = []): EngineState {
  return {
    nodeId: 'tool',
    local: {
      conversationId: 'conv-model-input',
      turnId: 'turn-model-input',
      history,
      runtimeEventSink: createRuntimeEventAdmissionSink('conv-model-input', 'run-model-input'),
      executorLocal: {
        stepCount: 1,
        lastSuccessfulLlmModelId: 'vision-model',
      },
      toolContext: { conversationId: 'conv-model-input', turnId: 'turn-model-input' },
      pendingToolCalls: [
        {
          id: ToolCallIdSchema.parse('call-1'),
          type: 'function',
          function: { name: 'resource_read', arguments: '{"uri":"asset://assets/asset-1"}' },
        },
      ],
    },
  };
}

function createNode(
  executeTool: ToolExecutionPort['executeTool'],
  options: {
    readonly definition?: Partial<ToolRuntimeDefinition>;
    readonly compatibility?:
      | { readonly compatible: true }
      | {
          readonly compatible: false;
          readonly reason: 'image_input_unsupported' | 'placement_unsupported';
          readonly missing_placements: readonly ['tool_result_image'];
        };
  } = {}
) {
  const resolveToolModelInput = vi.fn().mockResolvedValue(resolvedAttachments);
  const completeToolModelInput = vi.fn().mockResolvedValue(undefined);
  const assertCompatible = vi.fn();
  const evaluate = vi.fn(() => options.compatibility ?? { compatible: true as const });
  const node = new ToolNode({
    toolRuntime: {
      getToolDefinition: vi.fn(
        (): ToolRuntimeDefinition => ({
          parameters: {
            type: 'object',
            properties: { uri: { type: 'string', description: 'resource URI' } },
            required: ['uri'],
          },
          idempotency: { scope: 'conversation' },
          ...options.definition,
        })
      ),
      executeTool,
    },
    observationPreview: {
      truncateObservation: vi.fn().mockResolvedValue({ truncated: false, preview: 'image loaded' }),
    },
    modelInputResolver: { resolveToolModelInput, completeToolModelInput },
    modelInputCapabilityValidator: { evaluate, assertCompatible },
  });
  return { node, resolveToolModelInput, completeToolModelInput, evaluate, assertCompatible };
}

describe('ToolNode model input post-processing', () => {
  it('when_supported 工具对非视觉模型保留文字成功结果且不解析附件', async () => {
    const executeTool = vi.fn(
      async (_toolName, _args, context) =>
        ({
          success: true,
          result: JSON.stringify({
            data: { uri: 'conversation:/generated-images/image.png' },
            observation: 'image generated',
            ...(context.modelInputAdmission?.admitted === true
              ? { modelInput: { attachments: [{ id: 'selection-1', uri: 'claim://selection-1' }] } }
              : {}),
          }),
          durationMs: 8,
        }) satisfies ToolExecutionResult
    );
    const { node, resolveToolModelInput, evaluate, assertCompatible } = createNode(executeTool, {
      definition: {
        modelInputRequirement: {
          requires_image_input: true,
          placements: ['tool_result_image'],
        },
        modelInputDelivery: 'when_supported',
      },
      compatibility: {
        compatible: false,
        reason: 'image_input_unsupported',
        missing_placements: ['tool_result_image'],
      },
    });

    const result = await node.run(buildState());
    const output = result.events?.find(event => event.type === 'tool_output');

    expect(evaluate).toHaveBeenCalledOnce();
    expect(assertCompatible).not.toHaveBeenCalled();
    expect(executeTool).toHaveBeenCalledOnce();
    expect(resolveToolModelInput).not.toHaveBeenCalled();
    expect(output).toMatchObject({
      type: 'tool_output',
      status: 'success',
      observation: 'image generated',
    });
    expect(output).not.toHaveProperty('attachments');
  });

  it('when_supported 工具对视觉模型写入真实工具结果图片', async () => {
    const executeTool = vi.fn(
      async (_toolName, _args, context) =>
        ({
          success: true,
          result:
            context.modelInputAdmission?.admitted === true
              ? structuredOutput
              : JSON.stringify({ data: {}, observation: 'image generated' }),
          durationMs: 8,
        }) satisfies ToolExecutionResult
    );
    const { node, resolveToolModelInput, evaluate } = createNode(executeTool, {
      definition: {
        modelInputRequirement: {
          requires_image_input: true,
          placements: ['tool_result_image'],
        },
        modelInputDelivery: 'when_supported',
      },
    });

    const result = await node.run(buildState());
    const output = result.events?.find(event => event.type === 'tool_output');

    expect(evaluate).toHaveBeenCalledOnce();
    expect(resolveToolModelInput).toHaveBeenCalledOnce();
    expect(output).toMatchObject({
      type: 'tool_output',
      status: 'success',
      attachments: resolvedAttachments,
    });
  });

  it('when_supported 工具在非视觉模型下不复用历史视觉附件', async () => {
    const args = { uri: 'asset://assets/asset-1' };
    const idempotencyKey = computeToolIdempotencyKey({
      policy: { scope: 'conversation' },
      toolName: 'resource_read',
      args,
      context: { conversationId: 'conv-model-input' },
    });
    const cached = createToolOutputEvent(
      'cached-vision-event',
      'conv-model-input',
      'previous-turn',
      'resource_read',
      'previous-call',
      {
        status: 'success',
        observation: 'image generated',
        data: { uri: 'conversation:/generated-images/image.png' },
      },
      {
        metadata: { idempotency: { key: idempotencyKey } },
        attachments: resolvedAttachments,
      }
    );
    const executeTool = vi.fn();
    const { node, resolveToolModelInput } = createNode(executeTool, {
      definition: {
        modelInputRequirement: {
          requires_image_input: true,
          placements: ['tool_result_image'],
        },
        modelInputDelivery: 'when_supported',
      },
      compatibility: {
        compatible: false,
        reason: 'image_input_unsupported',
        missing_placements: ['tool_result_image'],
      },
    });

    const result = await node.run(buildState([cached]));
    const output = result.events?.find(event => event.type === 'tool_output');

    expect(executeTool).not.toHaveBeenCalled();
    expect(resolveToolModelInput).not.toHaveBeenCalled();
    expect(output).toMatchObject({
      type: 'tool_output',
      status: 'success',
      observation: 'image generated',
    });
    expect(output).not.toHaveProperty('attachments');
  });

  it('首次执行统一解析 selection、校验 active model 并写入 tool event attachments', async () => {
    const executeTool = vi.fn().mockResolvedValue({
      success: true,
      result: structuredOutput,
      durationMs: 8,
    } satisfies ToolExecutionResult);
    const { node, resolveToolModelInput, completeToolModelInput, assertCompatible } =
      createNode(executeTool);

    const result = await node.run(buildState());
    const output = result.events?.find(event => event.type === 'tool_output');

    expect(resolveToolModelInput).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'resource_read',
        toolCallId: 'call-1',
        selections: [
          { id: 'selection-1', uri: 'asset://assets/asset-1' },
          { id: 'selection-2', uri: 'asset://assets/asset-2' },
        ],
      })
    );
    expect(assertCompatible).toHaveBeenCalledWith({
      activeModelId: 'vision-model',
      requirement: {
        requires_image_input: true,
        placements: ['tool_result_image'],
      },
    });
    expect(output).toMatchObject({
      type: 'tool_output',
      status: 'success',
      attachments: resolvedAttachments,
    });
    expect(completeToolModelInput).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'call-1',
      })
    );
  });

  it('工具结果合同或附件解析失败时仍结束当前调用的临时输入生命周期', async () => {
    const invalid = createNode(
      vi.fn().mockResolvedValue({
        success: true,
        result: JSON.stringify({ data: {}, modelInput: { attachments: 'invalid' } }),
        durationMs: 4,
      } satisfies ToolExecutionResult)
    );
    await invalid.node.run(buildState());
    expect(invalid.completeToolModelInput).toHaveBeenCalledOnce();
    expect(invalid.resolveToolModelInput).not.toHaveBeenCalled();

    const resolverFailure = createNode(
      vi.fn().mockResolvedValue({
        success: true,
        result: structuredOutput,
        durationMs: 4,
      } satisfies ToolExecutionResult)
    );
    resolverFailure.resolveToolModelInput.mockRejectedValueOnce(new Error('resolver failed'));
    await resolverFailure.node.run(buildState());
    expect(resolverFailure.completeToolModelInput).toHaveBeenCalledOnce();
  });

  it('历史 cache hit 不重跑工具，并复用已经 admission 的正式附件', async () => {
    const args = { uri: 'asset://assets/asset-1' };
    const idempotencyKey = computeToolIdempotencyKey({
      policy: { scope: 'conversation' },
      toolName: 'resource_read',
      args,
      context: { conversationId: 'conv-model-input' },
    });
    const cached = createToolOutputEvent(
      'cached-event',
      'conv-model-input',
      'previous-turn',
      'resource_read',
      'previous-call',
      {
        status: 'success',
        observation: 'image loaded',
        data: { uri: 'asset://assets/asset-1' },
      },
      {
        metadata: { idempotency: { key: idempotencyKey } },
        attachments: resolvedAttachments,
      }
    );
    const executeTool = vi.fn();
    const { node, resolveToolModelInput } = createNode(executeTool);

    const result = await node.run(buildState([cached]));
    const output = result.events?.find(event => event.type === 'tool_output');

    expect(executeTool).not.toHaveBeenCalled();
    expect(resolveToolModelInput).not.toHaveBeenCalled();
    expect(output).toMatchObject({
      type: 'tool_output',
      status: 'success',
      ephemeral: true,
      attachments: resolvedAttachments,
    });
  });

  it('同进程 in-flight 合并只执行一次工具，两条结果各自走 resolver 并保持附件', async () => {
    let release!: () => void;
    const canFinish = new Promise<void>(resolve => {
      release = resolve;
    });
    const executeTool = vi.fn(async () => {
      await canFinish;
      return {
        success: true,
        result: structuredOutput,
        durationMs: 8,
      } satisfies ToolExecutionResult;
    });
    const { node, resolveToolModelInput } = createNode(executeTool);

    const first = node.run(buildState());
    const second = node.run(buildState());
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(executeTool).toHaveBeenCalledOnce();
    expect(resolveToolModelInput).toHaveBeenCalledTimes(2);
    for (const result of [firstResult, secondResult]) {
      expect(result.events?.find(event => event.type === 'tool_output')).toMatchObject({
        status: 'success',
        attachments: resolvedAttachments,
      });
    }
  });
});
