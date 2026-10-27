import { z } from 'zod';
import { ResearchRunArgsSchema } from '@app/schemas';
import { DecisionModelSchema, DecisionRecommendationSchema, DecisionUpdateSchema, DecisionScenariosSchema, DecisionActionPlanSchema, DecisionActionResolutionSchema } from '../../../../shared';

export const DECISION_CLI_HELP = `Linnya decision prototype
  linnya-decision create --json '<model>'
  linnya-decision research prepare <decision-id> --expected-revision <n> --json '<research scope>'
  linnya-decision research read|receive <request-id>
  linnya-decision research list <decision-id>
  linnya-decision list
  linnya-decision read <decision-id> [--revision <n>]
  linnya-decision compare <decision-id> --from <revision> --to <revision>
  linnya-decision update <decision-id> --expected-revision <n> --json '<update>'
  linnya-decision recommend <decision-id> --expected-revision <n> --json '<recommendation>'
  linnya-decision simulate <decision-id> --expected-revision <n> --json '<scenarios>'
  linnya-decision action plan <decision-id> --expected-revision <n> --json '<plan>'
  linnya-decision action resolve <decision-id> <action-id> --expected-revision <n> --json '<result with optional update>'
  For larger JSON, replace --json '<...>' with --input relative-file.json.
Use skill decision-exploration references/record.md for JSON shapes.
Commands operate only in the current project. read/recommendationStatus=current is not correctness certification.
`;

function parseJson(value: string): unknown { return JSON.parse(value); }
const positiveInteger = z.coerce.number().int().positive();
const decisionId = z.string().uuid();

export function parseDecisionCli(argv: readonly string[]) {
  const [command, ...rest] = argv;
  if (command === 'action') {
    const [operation, id, ...tail] = rest;
    const actionId = operation === 'resolve' ? decisionId.parse(tail[0]) : undefined;
    const flags = operation === 'resolve' ? tail.slice(1) : tail;
    if ((operation !== 'plan' && operation !== 'resolve') || flags.length !== 4
      || flags[0] !== '--expected-revision' || (flags[2] !== '--json' && flags[2] !== '--input')) {
      throw new Error(`Invalid action arguments.\n${DECISION_CLI_HELP}`);
    }
    const common = { id: decisionId.parse(id), expectedRevision: positiveInteger.parse(flags[1]) };
    const parsedOperation = operation === 'plan'
      ? { kind: 'action_plan', ...common } as const
      : { kind: 'action_resolve', ...common, actionId: decisionId.parse(actionId) } as const;
    if (flags[2] === '--input') return { kind: 'file', filePath: z.string().min(1).parse(flags[3]), operation: parsedOperation } as const;
    const payload = parseJson(z.string().parse(flags[3]));
    return parsedOperation.kind === 'action_plan'
      ? { ...parsedOperation, plan: DecisionActionPlanSchema.parse(payload) }
      : { ...parsedOperation, resolution: DecisionActionResolutionSchema.parse(payload) };
  }
  if (command === 'research') {
    const [operation, id, ...flags] = rest;
    if ((operation === 'read' || operation === 'receive' || operation === 'list') && flags.length === 0) {
      if (operation === 'read') return { kind: 'research_read', id: decisionId.parse(id) } as const;
      if (operation === 'receive') return { kind: 'research_receive', id: decisionId.parse(id) } as const;
      return { kind: 'research_list', id: decisionId.parse(id) } as const;
    }
    if (operation === 'prepare' && flags.length === 4 && flags[0] === '--expected-revision' && (flags[2] === '--json' || flags[2] === '--input')) {
      const common = { id: decisionId.parse(id), expectedRevision: positiveInteger.parse(flags[1]) };
      if (flags[2] === '--input') return { kind: 'file', filePath: z.string().min(1).parse(flags[3]), operation: { kind: 'research_prepare', ...common } } as const;
      return { kind: 'research_prepare', ...common,
        scope: ResearchRunArgsSchema.parse(parseJson(z.string().parse(flags[3]))) } as const;
    }
    throw new Error(`Invalid research arguments.\n${DECISION_CLI_HELP}`);
  }
  if (command === undefined || command === 'help' || command === '--help') return { kind: 'help' } as const;
  if (command === 'list' && rest.length === 0) return { kind: 'list' } as const;
  if (command === 'create' && rest.length === 2 && rest[0] === '--input') {
    return { kind: 'file', filePath: z.string().min(1).parse(rest[1]), operation: { kind: 'create' } } as const;
  }
  if (command === 'create' && rest.length === 2 && rest[0] === '--json') {
    return { kind: 'create', model: DecisionModelSchema.parse(parseJson(z.string().parse(rest[1]))) } as const;
  }
  if (command === 'read' && (rest.length === 1 || (rest.length === 3 && rest[1] === '--revision'))) {
    return {
      kind: 'read', id: decisionId.parse(rest[0]),
      revision: rest.length === 3 ? positiveInteger.parse(rest[2]) : undefined,
    } as const;
  }
  if (command === 'compare' && rest.length === 5 && rest[1] === '--from' && rest[3] === '--to') {
    return { kind: 'compare', id: decisionId.parse(rest[0]), fromRevision: positiveInteger.parse(rest[2]), toRevision: positiveInteger.parse(rest[4]) } as const;
  }
  if ((command === 'update' || command === 'recommend' || command === 'simulate') && rest.length === 5
    && rest[1] === '--expected-revision' && (rest[3] === '--json' || rest[3] === '--input')) {
    const common = { id: decisionId.parse(rest[0]), expectedRevision: positiveInteger.parse(rest[2]) };
    if (rest[3] === '--input') {
      return { kind: 'file', filePath: z.string().min(1).parse(rest[4]), operation: { kind: command, ...common } } as const;
    }
    const payload = parseJson(z.string().parse(rest[4]));
    if (command === 'simulate') return { kind: 'simulate', ...common, scenarios: DecisionScenariosSchema.parse(payload) } as const;
    return command === 'update'
      ? { kind: 'update', ...common, update: DecisionUpdateSchema.parse(payload) } as const
      : { kind: 'recommend', ...common, recommendation: DecisionRecommendationSchema.parse(payload) } as const;
  }
  throw new Error(`Invalid arguments.\n${DECISION_CLI_HELP}`);
}

export type DecisionCliCommand = ReturnType<typeof parseDecisionCli>;
export type InlineDecisionCliCommand = Exclude<DecisionCliCommand, { readonly kind: 'file' }>;

/** 文件 IO 在 access plan 准入后进行；解析仍复用与内联 JSON 相同的业务 schema。 */
export function parseDecisionFilePayload(
  command: Extract<DecisionCliCommand, { readonly kind: 'file' }>,
  content: string,
): InlineDecisionCliCommand {
  const payload = parseJson(content);
  if (command.operation.kind === 'create') {
    return { kind: 'create', model: DecisionModelSchema.parse(payload) };
  }
  const { id, expectedRevision } = command.operation;
  if (command.operation.kind === 'action_plan') {
    return { kind: 'action_plan', id, expectedRevision, plan: DecisionActionPlanSchema.parse(payload) };
  }
  if (command.operation.kind === 'action_resolve') {
    return { kind: 'action_resolve', id, expectedRevision, actionId: command.operation.actionId, resolution: DecisionActionResolutionSchema.parse(payload) };
  }
  if (command.operation.kind === 'research_prepare') {
    return { kind: 'research_prepare', id, expectedRevision, scope: ResearchRunArgsSchema.parse(payload) };
  }
  if (command.operation.kind === 'simulate') {
    return { kind: 'simulate', id, expectedRevision, scenarios: DecisionScenariosSchema.parse(payload) };
  }
  return command.operation.kind === 'update'
    ? { kind: 'update', id, expectedRevision, update: DecisionUpdateSchema.parse(payload) }
    : { kind: 'recommend', id, expectedRevision, recommendation: DecisionRecommendationSchema.parse(payload) };
}
