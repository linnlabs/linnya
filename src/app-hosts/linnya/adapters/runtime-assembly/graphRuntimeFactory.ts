import { graph, llm, telemetry } from '@linnlabs/linnkit/runtime-kernel';
import type {
  AuditPort,
  CanonicalInferencePort,
  LlmImageInputEstimatorPort,
  LlmInputMaterializerPort,
  TokenCounterPort,
  TokenizerPort,
} from '@linnlabs/linnkit/ports';
import { defaultToolRuntimePort } from 'src/app-hosts/linnya/adapters/tools/defaultPorts';
import { CLOUD_DEEPSEEK_REASONER_MODEL_ID } from 'src/domains/model-catalog';
import { LLM_FALLBACK_CHAT_MODEL_PREFERRED_ORDER } from 'src/app-hosts/linnya/agent-registry/system/llm_fallback';
import { createDefaultGraphExecutorContextBuilder } from 'src/app-hosts/linnya/adapters/context-injection/defaultGraphExecutorContextBuilder';
import type { LinnyaTokenCalibrationCollector } from 'src/app-hosts/linnya/adapters/token-accounting';
import { defaultModelCatalog } from './modelCatalog';
import { defaultModelRoutingPolicy } from 'src/app-hosts/linnya/adapters/model-routing-policy';
import { createDefaultLinnyaTokenCounter } from 'src/app-hosts/linnya/adapters/token-accounting';
import { defaultImageInputProcessingProfileRegistry } from 'src/app-hosts/linnya/adapters/llm-input-materialization';
import { createDefaultHostInferencePort } from 'src/app-hosts/linnya/adapters/inference';

export interface DefaultLlmCallerOptions {
  modelResolver?: llm.ModelResolver;
  modelCatalog?: llm.ModelCatalogLike;
  llmInputMaterializer?: LlmInputMaterializerPort;
  inferencePort?: CanonicalInferencePort;
}

export type DefaultGraphRuntimeLlmCaller =
  Pick<llm.LlmCaller, 'call' | 'callWithRetries'>;

export interface DefaultGraphRuntimeOverrides {
  llmCaller?: DefaultGraphRuntimeLlmCaller;
  toolRuntime?: graph.GraphAgentExecutorDependencies['toolRuntime'];
  contextBuilder?: graph.GraphExecutorContextBuilder;
  cloudQuotaFallbackModelId?: string;
  modelCatalog?: llm.ModelCatalogLike;
  modelResolver?: llm.ModelResolver;
  /**
   * 宿主提供的 telemetry sink。
   * 不传时 GraphAgentExecutor 用 noopTelemetry（observability 默认关闭）。
   */
  telemetryPort?: telemetry.TelemetryPort;
  /**
   * 宿主提供的 audit sink。
   * 不传时 GraphAgentExecutor 用 noopAudit；生产宿主应注入 EventStore-backed sink。
   */
  auditPort?: AuditPort;
  /**
   * 同一个 tokenizer 实例必须同时注入 context-manager 与 GraphAgentExecutor，
   * 否则预算估算和 telemetry 本地估算会产生两套口径。
   */
  tokenizer?: TokenizerPort;
  tokenCounter?: TokenCounterPort;
  llmImageInputEstimator?: LlmImageInputEstimatorPort;
  tokenCalibrationCollector?: LinnyaTokenCalibrationCollector;
  llmInputMaterializer?: LlmInputMaterializerPort;
}

/**
 * 当前 Linnya 宿主的默认 runtime 装配。
 *
 * 中文备注：
 * - 这里显式返回 host 侧要注入给 runtime kernel 的依赖袋；
 * - `GraphAgentExecutor` 只消费 ports，不知道这些默认实现来自 Linnya；
 * - 后续 Phase 2-1 可以在不改 executor 协议的前提下继续抽 host ports。
 */
export function createDefaultModelResolver(): llm.ModelResolver {
  return new llm.ModelResolver({
    fallbackModelPreferredOrder: LLM_FALLBACK_CHAT_MODEL_PREFERRED_ORDER,
    modelCatalog: defaultModelCatalog,
  });
}

export function createDefaultLlmCaller(options: DefaultLlmCallerOptions = {}): llm.LlmCaller {
  const modelCatalog = options.modelCatalog ?? defaultModelCatalog;
  const modelResolver = options.modelResolver ?? new llm.ModelResolver({
    fallbackModelPreferredOrder: LLM_FALLBACK_CHAT_MODEL_PREFERRED_ORDER,
    modelCatalog,
  });
  return new llm.LlmCaller({
    modelResolver,
    modelCatalog,
    policyEngine: defaultModelRoutingPolicy,
    inferencePort: options.inferencePort ?? createDefaultHostInferencePort(),
    llmInputMaterializer: options.llmInputMaterializer,
  });
}

export function createDefaultGraphRuntimeDependencies(
  overrides: DefaultGraphRuntimeOverrides = {},
): graph.GraphAgentExecutorDependencies {
  const modelCatalog = overrides.modelCatalog ?? defaultModelCatalog;
  const modelResolver = overrides.modelResolver ?? new llm.ModelResolver({
    fallbackModelPreferredOrder: LLM_FALLBACK_CHAT_MODEL_PREFERRED_ORDER,
    modelCatalog,
  });
  const llmCaller: DefaultGraphRuntimeLlmCaller =
    overrides.llmCaller ?? createDefaultLlmCaller({
      modelResolver,
      modelCatalog,
      llmInputMaterializer: overrides.llmInputMaterializer,
    });
  const tokenizer = overrides.tokenizer ?? llm.createDefaultTokenizerPort();
  const tokenCounter = overrides.tokenCounter ?? createDefaultLinnyaTokenCounter();
  const contextBuilder: graph.GraphExecutorContextBuilder =
    overrides.contextBuilder ??
    createDefaultGraphExecutorContextBuilder({
      tokenizer,
      tokenCounter,
      imageInputEstimator:
        overrides.llmImageInputEstimator ?? defaultImageInputProcessingProfileRegistry,
      tokenCalibrationCollector: overrides.tokenCalibrationCollector,
      resolveModelInferenceRoute:
        modelId => modelCatalog.getModelById(modelId)?.inference_route,
      resolveTokenRoute:
        modelId => modelCatalog.getModelById(modelId)?.token_route,
    });

  return {
    llmCaller,
    toolRuntime: overrides.toolRuntime ?? defaultToolRuntimePort,
    contextBuilder,
    cloudQuotaFallbackModelId:
      overrides.cloudQuotaFallbackModelId ?? CLOUD_DEEPSEEK_REASONER_MODEL_ID,
    modelCatalog,
    modelResolver,
    telemetryPort: overrides.telemetryPort,
    auditPort: overrides.auditPort,
    tokenizer,
    tokenCounter,
    resolveTokenRoute: modelId => modelCatalog.getModelById(modelId)?.token_route,
  };
}

export function createDefaultGraphAgentExecutor(
  overrides: DefaultGraphRuntimeOverrides = {},
): graph.GraphAgentExecutor {
  return new graph.GraphAgentExecutor(createDefaultGraphRuntimeDependencies(overrides));
}

export function createDefaultLlmNode(
  overrides: DefaultGraphRuntimeOverrides = {},
): graph.LlmNode {
  return new graph.LlmNode({
    reasoner: createDefaultGraphAgentExecutor(overrides),
  });
}
