/**
 * @file src/agent/runtime-kernel/graph-engine/executor.ts
 *
 * @brief 图执行引擎的单步推理执行器
 */
import type { LlmCaller } from '../llm/caller';
import { createEmptyModelCatalog, type ModelCatalogLike } from '../llm/modelCatalog';
import { ModelResolver, type ModelResolverLike } from '../llm/modelResolver';
import { noopTelemetry } from '../telemetry/noopTelemetry';
import type { TelemetryPort } from '../telemetry/telemetryPort';
import { noopAudit } from '../audit/noopAudit';
import type { AuditPort, TokenCounterPort } from '../../ports';
import type { TokenRoute } from '../../contracts';
import { createDefaultTokenizerPort } from '../../shared/defaultTokenizerPort';
import type { TokenizerPort } from '../../ports';
import type { ToolCatalogPort } from '../tools/ports';
import { Logger } from '../../shared/logger';
import type { GraphExecutorContextBuilder } from './executorContextBuilder';
import { readNonEmptyString, requireRuntimeIdentity } from './tick-pipeline/helpers';
import { llmTelemetryMiddleware } from './tick-pipeline/middlewares/llmTelemetryMiddleware';
import { runModelLockMiddleware } from './tick-pipeline/middlewares/runModelLockMiddleware';
import { runTickPipeline } from './tick-pipeline/runTickPipeline';
import { createApplySystemReminderStage } from './tick-pipeline/stages/applySystemReminderStage';
import { createBuildContextStage } from './tick-pipeline/stages/buildContextStage';
import { createBuildDecisionStage } from './tick-pipeline/stages/buildDecisionStage';
import { createExecuteLlmStage } from './tick-pipeline/stages/executeLlmStage';
import { createMeasurePromptUsageStage } from './tick-pipeline/stages/measurePromptUsageStage';
import { createAdmitPromptCapacityStage } from './tick-pipeline/stages/admitPromptCapacityStage';
import { createCompactContextStage } from './tick-pipeline/stages/compactContextStage';
import { createCommitContextCompactionStage } from './tick-pipeline/stages/commitContextCompactionStage';
import { createPrepareCallStage } from './tick-pipeline/stages/prepareCallStage';
import type {
  TickAroundMiddleware,
  TickEvent,
  TickInput,
  TickOutput,
  TickPipelineContext,
  TickStage,
} from './tick-pipeline/types';
import { createPromptUsageMeasurer } from './orchestration/measurePromptUsage';

export type { AgentStepDecision, TickEvent, TickInput, TickOutput } from './tick-pipeline/types';

const logger = new Logger('GraphAgentExecutor');

export interface GraphAgentExecutorOptions {
  cloudQuotaFallbackModelId?: string;
  modelCatalog?: ModelCatalogLike;
  modelResolver?: Pick<ModelResolverLike, 'resolveModelId'>;
}

export type GraphAgentExecutorToolRuntime = Pick<
  ToolCatalogPort,
  'getToolSchemas' | 'getToolDefinition'
>;

export interface GraphAgentExecutorLlmCaller
  extends Pick<LlmCaller, 'callWithRetries'>,
  Partial<Pick<LlmCaller, 'call'>> {}

export interface GraphAgentExecutorDependencies extends GraphAgentExecutorOptions {
  llmCaller: GraphAgentExecutorLlmCaller;
  toolRuntime: GraphAgentExecutorToolRuntime;
  contextBuilder: GraphExecutorContextBuilder;
  /**
   * 可选：宿主提供的 TelemetryPort 实现。
   * 不传时使用 noopTelemetry（保持当前行为：observability 默认关闭，零业务影响）。
   */
  telemetryPort?: TelemetryPort;
  auditPort?: AuditPort;
  tokenizer?: TokenizerPort;
  tokenCounter?: TokenCounterPort;
  resolveTokenRoute?: (modelId: string) => TokenRoute | undefined;
}

export class GraphAgentExecutor {
  private readonly llmCaller: GraphAgentExecutorLlmCaller;
  private readonly toolRuntime: GraphAgentExecutorToolRuntime;
  private readonly contextBuilder: GraphExecutorContextBuilder;
  private readonly cloudQuotaFallbackModelId?: string;
  private readonly modelResolver: Pick<ModelResolverLike, 'resolveModelId'>;
  private readonly modelCatalog: ModelCatalogLike;
  private readonly telemetryPort: TelemetryPort;
  private readonly auditPort: AuditPort;
  private readonly tokenizer: TokenizerPort;
  private readonly stages: TickStage[];
  private readonly middlewares: TickAroundMiddleware[];

  constructor(dependencies: GraphAgentExecutorDependencies) {
    this.llmCaller = dependencies.llmCaller;
    this.toolRuntime = dependencies.toolRuntime;
    this.contextBuilder = dependencies.contextBuilder;
    this.cloudQuotaFallbackModelId = readNonEmptyString(dependencies.cloudQuotaFallbackModelId);
    this.modelCatalog = dependencies.modelCatalog ?? createEmptyModelCatalog();
    this.modelResolver =
      dependencies.modelResolver ??
      new ModelResolver({
        modelCatalog: this.modelCatalog,
      });
    this.telemetryPort = dependencies.telemetryPort ?? noopTelemetry;
    this.auditPort = dependencies.auditPort ?? noopAudit;
    this.tokenizer = dependencies.tokenizer ?? createDefaultTokenizerPort();
    const promptUsageMeasurer = createPromptUsageMeasurer({
      tokenizer: this.tokenizer,
      tokenCounter: dependencies.tokenCounter,
      resolveTokenRoute: dependencies.resolveTokenRoute,
    });
    this.stages = [
      createPrepareCallStage({
        modelResolver: this.modelResolver,
        modelCatalog: this.modelCatalog,
        toolCatalog: this.toolRuntime,
        cloudQuotaFallbackModelId: this.cloudQuotaFallbackModelId,
      }),
      createBuildContextStage({
        contextBuilder: this.contextBuilder,
      }),
      createApplySystemReminderStage(),
      createMeasurePromptUsageStage({ promptUsageMeasurer }),
      createCompactContextStage({
        llmCaller: this.llmCaller,
        modelCatalog: this.modelCatalog,
        contextBuilder: this.contextBuilder,
        promptUsageMeasurer,
      }),
      createAdmitPromptCapacityStage(),
      createCommitContextCompactionStage(),
      createExecuteLlmStage({
        llmCaller: this.llmCaller,
        promptUsageMeasurer,
        modelCatalog: this.modelCatalog,
      }),
      createBuildDecisionStage(),
    ];
    this.middlewares = [llmTelemetryMiddleware, runModelLockMiddleware];
  }

  async tick(input: TickInput, eventHandler?: (event: TickEvent) => void): Promise<TickOutput> {
    const ctx: TickPipelineContext = {
      input,
      eventHandler,
      request: input.request,
      history: input.history,
      signal: input.signal,
      forceFinalAnswer: input.forceFinalAnswer === true,
      executorLocal: input.executorLocal,
      summarizationCallbacks: input.summarizationCallbacks,
      runtimeEventCommitPort: input.runtimeEventCommitPort,
      modelId: '',
      toolSchemas: [],
      toolCallStreamingPolicies: {},
      toolModelInputRequirement: undefined,
      llmOptions: {},
      toolDefinitionTokens: 0,
      llmMessages: [],
      conversationId: requireRuntimeIdentity(input.toolContext?.conversationId, 'conversationId'),
      turnId: requireRuntimeIdentity(input.toolContext?.turnId, 'turnId'),
      telemetry: this.telemetryPort,
      audit: this.auditPort,
      tokenizer: this.tokenizer,
    };

    logger.info('[GraphAgentExecutor] tick 调用', {
      stream: input.stream === true,
      hasEventHandler: Boolean(eventHandler),
      hasSummarizationCallbacks: Boolean(input.summarizationCallbacks),
    });

    await runTickPipeline(ctx, this.stages, this.middlewares);

    return {
      decision: ctx.decision ?? { kind: 'yield' },
      executorLocalPatch: ctx.executorLocalPatch,
      contextTrace: ctx.contextTrace,
      contextUsage: ctx.contextUsage,
    };
  }
}
