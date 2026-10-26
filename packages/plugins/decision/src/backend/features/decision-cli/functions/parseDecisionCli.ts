import { z } from 'zod';
import { DecisionModelSchema, DecisionRecommendationSchema, DecisionUpdateSchema } from '../../../../shared';

export const DECISION_CLI_HELP = `Linnya decision prototype
  linnya-decision create --json '<model>'
  linnya-decision list
  linnya-decision read <decision-id> [--revision <n>]
  linnya-decision update <decision-id> --expected-revision <n> --json '<update>'
  linnya-decision recommend <decision-id> --expected-revision <n> --json '<recommendation>'
  For larger JSON, replace --json '<...>' with --input relative-file.json.
Use skill decision-exploration references/record.md for JSON shapes.
Commands operate only in the current project. read/recommendationStatus=current is not correctness certification.
`;

function parseJson(value: string): unknown { return JSON.parse(value); }
const positiveInteger = z.coerce.number().int().positive();
const decisionId = z.string().uuid();

export function parseDecisionCli(argv: readonly string[]) {
  const [command, ...rest] = argv;
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
  if ((command === 'update' || command === 'recommend') && rest.length === 5
    && rest[1] === '--expected-revision' && (rest[3] === '--json' || rest[3] === '--input')) {
    const common = { id: decisionId.parse(rest[0]), expectedRevision: positiveInteger.parse(rest[2]) };
    if (rest[3] === '--input') {
      return { kind: 'file', filePath: z.string().min(1).parse(rest[4]), operation: { kind: command, ...common } } as const;
    }
    const payload = parseJson(z.string().parse(rest[4]));
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
  return command.operation.kind === 'update'
    ? { kind: 'update', id, expectedRevision, update: DecisionUpdateSchema.parse(payload) }
    : { kind: 'recommend', id, expectedRevision, recommendation: DecisionRecommendationSchema.parse(payload) };
}
