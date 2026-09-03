import type { AnyAgentEvent } from '../../../events/agentEvents';
import type { LlmCaller } from '../../../llm/caller';
import { defineTickStage } from '../types';
import type { ModelFallbackAudit, TickPipelineContext, TickStage } from '../types';
import { readNonEmptyString } from '../helpers';
import { emitAuditEnvelope } from '../../../audit/emitAudit';
import type { GraphExecutorOutputProcessor } from '../../executorContextBuilder';
import type { ModelFallbackRejectedInfo } from '../../../llm';
import { runIdFromTurnId } from '../../../../contracts';
import type { ContextUsageSnapshot } from '../../../../contracts';
import type { PromptUsageMeasurer } from '../../orchestration/measurePromptUsage';
import type { ModelCatalogLike } from '../../../llm/modelCatalog';
import { evaluateFallbackPromptCapacity } from '../../../llm/functions/evaluateFallbackPromptCapacity';
import { estimatePromptUsageComponentWeights } from '../../functions/promptUsageComponents';
import { evaluatePrimaryPromptCapacity } from '../../functions/evaluatePrimaryPromptCapacity';
import { PrimaryPromptCapacityError } from '../../definitions/primaryPromptCapacityError';

export interface ExecuteLlmStageDependencies {
  llmCaller: Pick<LlmCaller, 'callWithRetries'>;
  promptUsageMeasurer: PromptUsageMeasurer;
  modelCatalog: Pick<ModelCatalogLike, 'getModelById'>;
}

export function createExecuteLlmStage(dependencies: ExecuteLlmStageDependencies): TickStage {
  return defineTickStage({
    id: 'execute_llm',
    reads: [
      'input',
      'eventHandler',
      'outputProcessor',
      'modelId',
      'llmMessages',
      'toolModelInputRequirement',
      'toolCallStreamingPolicies',
      'imageInputAdmissionEvidence',
      'llmOptions',
      'promptBudget',
      'promptUsageMeasurementPolicy',
      'promptUsageCandidate',
      'tokenizer',
      'signal',
      'audit',
      'conversationId',
      'turnId',
    ],
    writes: [
      'cloudQuotaFallbackAppliedModelId',
      'modelFallbackAudit',
      'llmCallStartedAt',
      'llmResp',
      'llmCallDurationMs',
      'executorLocalPatch',
      'contextUsage',
    ],
    async run(ctx) {
      let cloudQuotaFallbackAppliedModelId: string | undefined;
      let modelFallbackAudit: ModelFallbackAudit | undefined;
      let lastSuccessfulLlmModelId: string | undefined;
      let contextUsage: ContextUsageSnapshot | undefined;
      const modelFallbackRejections: ModelFallbackRejectedInfo[] = [];
      const promptBudget = ctx.promptBudget;
      const promptUsageMeasurementPolicy = ctx.promptUsageMeasurementPolicy;

      const streamEventHandler: ((event: AnyAgentEvent) => void) | undefined =
        ctx.input.stream && ctx.eventHandler
          ? (event: AnyAgentEvent) => {
              const processedEvent = processStreamEvent(event, ctx.outputProcessor);
              if (processedEvent) {
                ctx.eventHandler?.(processedEvent);
              }
            }
          : undefined;

      const llmCallStartedAt = Date.now();
      let llmResp: Awaited<ReturnType<typeof dependencies.llmCaller.callWithRetries>>;
      try {
        llmResp = await dependencies.llmCaller.callWithRetries(
          ctx.modelId,
          ctx.llmMessages,
          ctx.llmOptions,
          streamEventHandler,
          ctx.signal,
          {
            onCloudQuotaFallbackApplied(fallbackModelId) {
              cloudQuotaFallbackAppliedModelId = readNonEmptyString(fallbackModelId);
            },
            onLlmAttemptSucceeded(activeModelId, attemptContextUsage) {
              lastSuccessfulLlmModelId = readNonEmptyString(activeModelId);
              contextUsage = attemptContextUsage;
            },
            onModelFallbackApplied(info) {
              modelFallbackAudit = info;
            },
            onModelFallbackRejected(info) {
              modelFallbackRejections.push(info);
            },
          },
          {
            imageInputAdmissionEvidence: ctx.imageInputAdmissionEvidence,
            additionalModelInputRequirement: ctx.toolModelInputRequirement,
            toolCallStreamingPolicies: ctx.toolCallStreamingPolicies,
            ...(promptBudget && promptUsageMeasurementPolicy
              ? {
                  measurePromptUsage: async (activeModelId, messages) => {
                    const candidate = activeModelId === ctx.modelId && ctx.promptUsageCandidate
                      ? ctx.promptUsageCandidate
                      : await dependencies.promptUsageMeasurer({
                          budgetModelId: ctx.modelId,
                          servedModelId: activeModelId,
                          messages,
                          llmOptions: ctx.llmOptions,
                          promptBudget,
                          measurementPolicy: promptUsageMeasurementPolicy,
                          imageInputTokens: ctx.imageInputAdmissionEvidence?.attachments.reduce(
                            (total, attachment) => total + attachment.estimatedTokens,
                            0,
                          ) ?? 0,
                          signal: ctx.signal,
                        });
                    if (!evaluatePrimaryPromptCapacity(candidate).admitted) {
                      throw new PrimaryPromptCapacityError(candidate);
                    }
                    return candidate;
                  },
                  evaluateFallbackPromptCapacity: candidateModelId => {
                    const route = dependencies.modelCatalog.getModelById(candidateModelId)?.inference_route;
                    const imageInputTokens = ctx.imageInputAdmissionEvidence?.attachments.reduce(
                      (total, attachment) => total + attachment.estimatedTokens,
                      0,
                    ) ?? 0;
                    const weights = estimatePromptUsageComponentWeights({
                      messages: ctx.llmMessages,
                      tools: ctx.llmOptions.tools,
                      toolChoice: ctx.llmOptions.tool_choice,
                      tokenizer: ctx.tokenizer,
                      modelId: candidateModelId,
                      imageInputTokens,
                    });
                    return evaluateFallbackPromptCapacity({
                      contextWindowTokens: route?.context_window_tokens,
                      maxOutputTokens: route?.max_output_tokens,
                      requiredOutputLimitTokens: promptBudget.outputLimitTokens,
                      estimatedPromptTokens: weights.systemPromptTokens
                        + weights.conversationTokens
                        + weights.toolDefinitionTokens,
                    });
                  },
                }
              : {}),
          }
        );
      } catch (error) {
        await emitModelFallbackRejectionAudits(ctx, modelFallbackRejections);
        throw error;
      }
      const llmCallDurationMs = Date.now() - llmCallStartedAt;

      await emitModelFallbackRejectionAudits(ctx, modelFallbackRejections);

      if (modelFallbackAudit) {
        await emitAuditEnvelope(ctx.audit, {
          action: 'model.fallback',
          actor: { kind: 'system' },
          decision: {
            outcome: 'fallback',
            reason: modelFallbackAudit.reason,
            policy: modelFallbackAudit.policy,
            metadata: {
              fromModelId: modelFallbackAudit.fromModelId,
              toModelId: modelFallbackAudit.toModelId,
            },
          },
          evidence: [
            {
              kind: 'llm_error',
              summary: modelFallbackAudit.reason,
            },
          ],
          scope: {
            conversationId: ctx.conversationId || undefined,
            turnId: ctx.turnId,
            runId: ctx.input.toolContext?.runId ?? runIdFromTurnId(ctx.turnId),
            parentRunId: ctx.input.toolContext?.parentRunId,
            modelId: modelFallbackAudit.toModelId,
          },
        });
      }

      return {
        cloudQuotaFallbackAppliedModelId,
        modelFallbackAudit,
        llmCallStartedAt,
        llmResp,
        llmCallDurationMs,
        executorLocalPatch: lastSuccessfulLlmModelId ? { lastSuccessfulLlmModelId } : undefined,
        contextUsage,
      };
    },
  });
}

async function emitModelFallbackRejectionAudits(
  ctx: Readonly<Pick<TickPipelineContext, 'audit' | 'conversationId' | 'turnId' | 'input'>>,
  rejections: readonly ModelFallbackRejectedInfo[]
): Promise<void> {
  for (const rejection of rejections) {
    await emitAuditEnvelope(ctx.audit, {
      action: 'model.fallback',
      actor: { kind: 'system' },
      decision: {
        outcome: 'denied',
        reason: rejection.reason,
        policy: rejection.policy,
        metadata: {
          fromModelId: rejection.fromModelId,
          ...(rejection.candidateModelId ? { candidateModelId: rejection.candidateModelId } : {}),
          requiredPlacements: rejection.requiredPlacements,
        },
      },
      evidence: [
        {
          kind: 'model_input_capability',
          summary: rejection.reason,
        },
      ],
      scope: {
        conversationId: ctx.conversationId || undefined,
        turnId: ctx.turnId,
        runId: ctx.input.toolContext?.runId ?? runIdFromTurnId(ctx.turnId),
        parentRunId: ctx.input.toolContext?.parentRunId,
        modelId: rejection.candidateModelId ?? rejection.fromModelId,
      },
    });
  }
}

function processStreamEvent(
  event: AnyAgentEvent,
  outputProcessor: GraphExecutorOutputProcessor | undefined
): AnyAgentEvent | null {
  if (!outputProcessor?.processStreamChunk || event.type !== 'stream_chunk') {
    return event;
  }

  const processedContent = outputProcessor.processStreamChunk(event.content);
  if (processedContent.length === 0) {
    return null;
  }

  return {
    ...event,
    content: processedContent,
  };
}
