import type { PromptUsageMeasurer } from '../../orchestration/measurePromptUsage';
import { defineTickStage, type TickStage } from '../types';

export interface MeasurePromptUsageStageDependencies {
  promptUsageMeasurer: PromptUsageMeasurer;
}

export function createMeasurePromptUsageStage(
  dependencies: MeasurePromptUsageStageDependencies,
): TickStage {
  return defineTickStage({
    id: 'measure_prompt_usage',
    reads: [
      'modelId',
      'llmMessages',
      'llmOptions',
      'promptBudget',
      'promptUsageMeasurementPolicy',
      'imageInputAdmissionEvidence',
      'signal',
    ],
    writes: ['promptUsageCandidate'],
    async run(ctx) {
      if (!ctx.promptBudget || !ctx.promptUsageMeasurementPolicy) {
        return { promptUsageCandidate: undefined };
      }
      const imageInputTokens = ctx.imageInputAdmissionEvidence?.attachments.reduce(
        (total, attachment) => total + attachment.estimatedTokens,
        0,
      ) ?? 0;
      return {
        promptUsageCandidate: await dependencies.promptUsageMeasurer({
          budgetModelId: ctx.modelId,
          servedModelId: ctx.modelId,
          messages: ctx.llmMessages,
          llmOptions: ctx.llmOptions,
          promptBudget: ctx.promptBudget,
          measurementPolicy: ctx.promptUsageMeasurementPolicy,
          imageInputTokens,
          signal: ctx.signal,
        }),
      };
    },
  });
}
