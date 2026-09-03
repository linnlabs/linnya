import { createContextComponentLedgerEntry } from '../../../token-accounting';
import {
  generateContextLedgerEntryId,
  toSerializableJsonRecord,
} from '../../../../contracts';
import type { GraphExecutorContextBuilder } from '../../executorContextBuilder';
import { defineTickStage } from '../types';
import type { TickPipelineContext, TickStage } from '../types';

export interface BuildContextStageDependencies {
  contextBuilder: GraphExecutorContextBuilder;
}

export function createBuildContextStage(
  dependencies: BuildContextStageDependencies,
): TickStage {
  return defineTickStage({
    id: 'build_context',
    reads: [
      'request',
      'history',
      'modelId',
      'toolDefinitionTokens',
      'llmOptions',
      'signal',
      'telemetry',
      'conversationId',
      'turnId',
      'input',
    ],
    writes: [
      'llmMessages',
      'imageInputAdmissionEvidence',
      'outputProcessor',
      'contextTrace',
      'promptBudget',
      'promptUsageMeasurementPolicy',
      'llmOptions',
      'contextCompactionCandidate',
      'contextCompactionPolicy',
    ],
    async run(ctx) {
      const contextBuildResult = await dependencies.contextBuilder.build({
        request: ctx.request,
        history: ctx.history,
        modelId: ctx.modelId,
        toolDefinitionTokens: ctx.toolDefinitionTokens,
        signal: ctx.signal,
      });

      const contextTrace = toSerializableJsonRecord(contextBuildResult.contextTrace);

      if (contextBuildResult.tokenEstimate) {
        const tokenLedgerEntry = contextBuildResult.tokenLedgerEntry
          ?? createContextLedgerEntry(ctx, contextBuildResult);
        ctx.telemetry.emit({
          kind: 'context_build',
          modelId: ctx.modelId,
          tokenEstimate: contextBuildResult.tokenEstimate,
          ...(contextBuildResult.tokenComponents ? { tokenComponents: contextBuildResult.tokenComponents } : {}),
          ...(tokenLedgerEntry ? { tokenLedgerEntry } : {}),
          scope: {
            conversationId: ctx.conversationId,
            runId: ctx.input.toolContext?.runId,
            parentRunId: ctx.input.toolContext?.parentRunId,
            turnId: ctx.turnId,
          },
        });
      }

      return {
        llmMessages: contextBuildResult.llmMessages,
        imageInputAdmissionEvidence: contextBuildResult.imageInputAdmissionEvidence,
        outputProcessor: contextBuildResult.outputProcessor,
        contextTrace,
        promptBudget: contextBuildResult.promptBudget,
        promptUsageMeasurementPolicy: contextBuildResult.promptUsageMeasurementPolicy,
        contextCompactionCandidate: contextBuildResult.contextCompactionCandidate,
        contextCompactionPolicy: contextBuildResult.contextCompactionPolicy,
        llmOptions: contextBuildResult.promptBudget
          ? {
              ...ctx.llmOptions,
              max_tokens: contextBuildResult.promptBudget.outputLimitTokens,
              ...(contextBuildResult.cachePolicy
                ? { cache_policy: contextBuildResult.cachePolicy }
                : {}),
            }
          : contextBuildResult.cachePolicy
            ? { ...ctx.llmOptions, cache_policy: contextBuildResult.cachePolicy }
            : ctx.llmOptions,
      };
    },
  });
}

function createContextLedgerEntry(
  ctx: Readonly<Pick<TickPipelineContext, 'conversationId' | 'turnId' | 'input'>>,
  contextBuildResult: Awaited<ReturnType<GraphExecutorContextBuilder['build']>>,
) {
  const keptComponents = contextBuildResult.tokenComponents?.filter((component) => component.kept !== false) ?? [];
  if (keptComponents.length === 0) {
    return undefined;
  }

  const runId = ctx.input.toolContext?.runId ?? ctx.turnId;
  const createdAt = Date.now();
  return createContextComponentLedgerEntry({
    id: generateContextLedgerEntryId(),
    conversationId: ctx.conversationId,
    runId,
    parentRunId: ctx.input.toolContext?.parentRunId,
    turnId: ctx.turnId,
    route: contextBuildResult.tokenEstimate?.route,
    createdAt,
    components: keptComponents,
  });
}
