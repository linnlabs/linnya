/**
 * @file src/agent/runtime-kernel/llm/caller.ts
 *
 * @brief LLM 调用器 - 统一管理 LLM 调用、流式适配与重试编排
 *
 * @description
 * 这个文件只保留 orchestrator 职责：
 * - 构造依赖；
 * - 暴露 call / callStream / callWithRetries 公共方法；
 * - 把具体实现委托给 request-builder / streaming-adapter / retry-fallback 等模块。
 */

import type { AnyAgentEvent } from '../events/agentEvents';
import type { LlmCallOptions, LlmRequestMessage, ToolCall } from './caller.types';
import type { ModelCatalogLike } from './modelCatalog';
import type { ModelResolverLike } from './modelResolver';
import {
  buildLlmCallerDeps,
  type LlmCallerOptions,
  type NormalizedLlmCallerDeps,
} from './request-builder';
import { callLlmStream } from './streaming-adapter';
import { callWithRetryFallback } from './retry-fallback';
import { callPlainCompletion, type LlmCallResult } from './usage-telemetry';
import { deriveModelInputRequirement, mergeModelInputRequirements } from './input-capabilities';
import type { LlmFallbackObserver } from './definitions/llmFallbackObserver';
import type { LlmCallInvocationContext } from './definitions/llmCallInvocationContext';
import { runLlmInputPreflight } from './input-materialization';
import { generateTraceId } from '../../contracts';

export type {
  LlmCallOptions,
  LlmRequestMessage,
  LlmRetryConfig,
  ToolCall,
} from './caller.types';
export type { LlmCallerOptions } from './request-builder';
export type { LlmCallInvocationContext } from './definitions/llmCallInvocationContext';

/**
 * LLM 调用器。
 *
 * 中文备注：
 * - 具体策略实现拆到同目录小模块，避免 caller.ts 再次膨胀；
 * - public method 签名保持原样，保护现有 host / testkit 调用方。
 */
export class LlmCaller {
  private readonly deps: NormalizedLlmCallerDeps & {
    modelCatalog: ModelCatalogLike;
  };
  private readonly modelResolver: ModelResolverLike;

  constructor(options: LlmCallerOptions) {
    const modelCatalog = options.modelCatalog;
    const deps = buildLlmCallerDeps(options);
    this.deps = {
      ...deps,
      modelCatalog,
    };
    this.modelResolver = deps.modelResolver;
  }

  /**
   * 非流式 LLM 调用。
   */
  async call(
    modelId: string,
    messages: LlmRequestMessage[],
    options: LlmCallOptions = {},
    signal?: AbortSignal,
    invocationContext?: LlmCallInvocationContext
  ): Promise<LlmCallResult> {
    const resolvedMessages = await runLlmInputPreflight({
      activeModelId: modelId,
      messages,
      modelCatalog: this.deps.modelCatalog,
      materializer: this.deps.llmInputMaterializer,
      invocationContext,
    });
    return callPlainCompletion(
      this.deps.inferencePort,
      modelId,
      resolvedMessages,
      options,
      signal,
      generateTraceId()
    );
  }

  /**
   * 流式 LLM 调用。
   */
  async callStream(
    modelId: string,
    messages: LlmRequestMessage[],
    options: LlmCallOptions = {},
    eventHandler: (event: AnyAgentEvent) => void,
    signal?: AbortSignal,
    invocationContext?: LlmCallInvocationContext
  ): Promise<LlmCallResult> {
    const resolvedMessages = await runLlmInputPreflight({
      activeModelId: modelId,
      messages,
      modelCatalog: this.deps.modelCatalog,
      materializer: this.deps.llmInputMaterializer,
      invocationContext,
      eventHandler,
    });
    return callLlmStream({
      inferencePort: this.deps.inferencePort,
      modelId,
      messages: resolvedMessages,
      options,
      eventHandler,
      signal,
      toolCallStreamingPolicies: invocationContext?.toolCallStreamingPolicies,
      traceId: generateTraceId(),
    });
  }

  /**
   * 带智能重试和模型降级的 LLM 调用。
   */
  async callWithRetries(
    modelId: string,
    messages: LlmRequestMessage[],
    options: LlmCallOptions = {},
    eventHandler?: (event: AnyAgentEvent) => void,
    signal?: AbortSignal,
    fallbackObserver?: LlmFallbackObserver,
    invocationContext?: LlmCallInvocationContext
  ): Promise<LlmCallResult> {
    const requirement = mergeModelInputRequirements(
      deriveModelInputRequirement(messages),
      invocationContext?.additionalModelInputRequirement
    );
    return callWithRetryFallback({
      deps: this.deps,
      modelId,
      messages,
      requirement,
      options,
      eventHandler,
      signal,
      fallbackObserver,
      invocationContext,
    });
  }

  /**
   * 获取或使用默认模型 ID。
   */
  resolveModelId(requestedModelId?: string): string {
    return this.modelResolver.resolveModelId(requestedModelId);
  }
}
