import { z } from 'zod';
import { DecisionActionPlanSchema, DecisionActionResolutionSchema, DecisionActionWithdrawalRequestSchema, DecisionActionProgressSchema, DecisionActionReviewRequestSchema } from '../../../../shared';

export function parseDecisionActionCli(rest: readonly string[]) {
  const [operation, id, ...tail] = rest;
  if (operation !== 'plan' && operation !== 'resolve' && operation !== 'withdraw' && operation !== 'progress' && operation !== 'review') {
    throw new Error('Use action plan, progress, review, resolve or withdraw. See linnya-decision --help.');
  }
  const flags = operation === 'plan' ? tail : tail.slice(1);
  if (flags.length !== 4 || flags[0] !== '--expected-revision' || (flags[2] !== '--json' && flags[2] !== '--input')) {
    throw new Error('Action requires --expected-revision <n> and --json <payload> or --input <file>.');
  }
  const common = { id: z.string().uuid().parse(id), expectedRevision: z.coerce.number().int().positive().parse(flags[1]) };
  const target = operation === 'plan' ? { kind: 'action_plan', ...common } as const
    : operation === 'resolve' ? { kind: 'action_resolve', ...common, actionId: z.string().uuid().parse(tail[0]) } as const
      : operation === 'withdraw' ? { kind: 'action_withdraw', ...common, actionId: z.string().uuid().parse(tail[0]) } as const
        : operation === 'progress' ? { kind: 'action_progress', ...common, actionId: z.string().uuid().parse(tail[0]) } as const
          : { kind: 'action_review', ...common, actionId: z.string().uuid().parse(tail[0]) } as const;
  if (flags[2] === '--input') return { kind: 'file', filePath: z.string().min(1).parse(flags[3]), operation: target } as const;
  const payload: unknown = JSON.parse(z.string().parse(flags[3]));
  if (target.kind === 'action_plan') return { ...target, plan: DecisionActionPlanSchema.parse(payload) };
  if (target.kind === 'action_resolve') return { ...target, resolution: DecisionActionResolutionSchema.parse(payload) };
  if (target.kind === 'action_withdraw') return { ...target, withdrawal: DecisionActionWithdrawalRequestSchema.parse(payload) };
  if (target.kind === 'action_progress') return { ...target, progress: DecisionActionProgressSchema.parse(payload) };
  return { ...target, review: DecisionActionReviewRequestSchema.parse(payload) };
}
