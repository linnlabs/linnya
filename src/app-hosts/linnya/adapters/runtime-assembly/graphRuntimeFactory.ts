import { graph, llm, telemetry } from '@linnlabs/linnkit/runtime-kernel';
import type { agentTools } from '@linnlabs/linnkit/context-manager';
import { mergeContextPolicy } from '@linnlabs/linnkit/context-manager';
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
import { LINNYA_CONTEXT_POLICY_FALLBACK } from 'src/app-hosts/linnya/context-policies/defaultContextPolicy';

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
  /** 自定义工具目录时配套注入名称、校验和摘要能力，避免使用全局 registry。 */
  toolManager?: agentTools.ToolManager;
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
    // 传输抖动可多等几次；损坏输出会重新生成长上下文，不能一并翻倍其付费机会。
    // 分类计数、退避、取消与混合错误的总 attempt 上限仍由 Linnkit 唯一拥有。
    maxRetries: 6,
    maxRetriesByCategory: { output: 3, rate_limit: 3, other: 3 },
    retryDelayMs: 1_500,
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
  // 显式注入会接管 Context Manager 的 tokenizer；必须继承框架与 Host 的默认配置，
  // 否则空配置会把原有 encoding 静默降为字符粗估，并提前触发历史整理。
  const tokenizer = overrides.tokenizer ?? llm.createDefaultTokenizerPort(
    mergeContextPolicy({ hostFallback: LINNYA_CONTEXT_POLICY_FALLBACK }).tokenEstimation,
  );
  const tokenCounter = overrides.tokenCounter ?? createDefaultLinnyaTokenCounter();
  const contextBuilder: graph.GraphExecutorContextBuilder =
    overrides.contextBuilder ??
    createDefaultGraphExecutorContextBuilder({
      toolManager: overrides.toolManager,
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
