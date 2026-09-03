import { PrimaryPromptCapacityError } from '../../definitions/primaryPromptCapacityError';
import { evaluatePrimaryPromptCapacity } from '../../functions/evaluatePrimaryPromptCapacity';
import { defineTickStage, type TickStage } from '../types';

/** 在任何 Provider 副作用发生前，接纳 reminder 后的主模型最终 Prompt。 */
export function createAdmitPromptCapacityStage(): TickStage {
  return defineTickStage({
    id: 'admit_prompt_capacity',
    reads: ['promptUsageCandidate'],
    writes: [],
    async run(ctx) {
      if (!ctx.promptUsageCandidate) return;

      const admission = evaluatePrimaryPromptCapacity(ctx.promptUsageCandidate);
      if (!admission.admitted) {
        throw new PrimaryPromptCapacityError(ctx.promptUsageCandidate);
      }
    },
  });
}
