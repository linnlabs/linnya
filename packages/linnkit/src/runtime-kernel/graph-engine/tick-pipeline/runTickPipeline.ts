import type {
  TickAroundMiddleware,
  TickMiddlewarePatch,
  TickPipelineContext,
  TickStage,
  TickStageContextKey,
  TickStagePatch,
} from './types';

const tickPipelineContextKeys = [
  'input',
  'eventHandler',
  'request',
  'history',
  'signal',
  'forceFinalAnswer',
  'executorLocal',
  'executorLocalPatch',
  'summarizationCallbacks',
  'runtimeEventCommitPort',
  'modelId',
  'toolSchemas',
  'toolModelInputRequirement',
  'toolCallStreamingPolicies',
  'llmOptions',
  'toolDefinitionTokens',
  'promptBudget',
  'promptUsageMeasurementPolicy',
  'promptUsageCandidate',
  'contextUsage',
  'llmMessages',
  'imageInputAdmissionEvidence',
  'contextCompactionCandidate',
  'contextCompactionPolicy',
  'pendingContextCompaction',
  'conversationId',
  'turnId',
  'llmCallStartedAt',
  'llmCallDurationMs',
  'llmResp',
  'outputProcessor',
  'decision',
  'systemReminderHitRuleIds',
  'contextTrace',
  'cloudQuotaFallbackAppliedModelId',
  'modelFallbackAudit',
  'telemetry',
  'audit',
  'tokenizer',
] satisfies readonly TickStageContextKey[];

const TICK_PIPELINE_CONTEXT_KEYS = new Set<string>(tickPipelineContextKeys);

export function applyTickStagePatch(
  ctx: TickPipelineContext,
  stage: TickStage,
  patch: TickStagePatch | void
): void {
  if (!patch) {
    return;
  }

  const allowedWrites = new Set<string>(stage.writes);
  for (const key of Object.keys(patch)) {
    if (!TICK_PIPELINE_CONTEXT_KEYS.has(key) || !allowedWrites.has(key)) {
      throw new Error(`TickStage ${stage.id} returned undeclared patch field: ${key}`);
    }
  }

  const { executorLocalPatch, ...contextPatch } = patch;
  Object.assign(ctx, contextPatch);
  if (executorLocalPatch) {
    ctx.executorLocalPatch = {
      ...(ctx.executorLocalPatch ?? {}),
      ...executorLocalPatch,
    };
  }
}

export function applyTickMiddlewarePatch(
  ctx: TickPipelineContext,
  patch: TickMiddlewarePatch | void
): void {
  if (!patch?.executorLocalPatch) {
    return;
  }

  ctx.executorLocalPatch = {
    ...(ctx.executorLocalPatch ?? {}),
    ...patch.executorLocalPatch,
  };
}

export async function runTickPipeline(
  ctx: TickPipelineContext,
  stages: readonly TickStage[],
  middlewares: readonly TickAroundMiddleware[] = []
): Promise<void> {
  for (const stage of stages) {
    let runner = async () => {
      const patch = await stage.run(ctx);
      applyTickStagePatch(ctx, stage, patch);
    };

    for (let index = middlewares.length - 1; index >= 0; index -= 1) {
      const middleware = middlewares[index]!;
      const next = runner;
      runner = async () => {
        const patch = await middleware(ctx, stage, next);
        applyTickMiddlewarePatch(ctx, patch);
      };
    }

    await runner();
  }
}
