import { z } from 'zod';

export const COMMAND_RUNNER_UTILITY_ACK_DEADLINE_MS = 10_000;

const CommandRunnerUtilityGenerationSchema = z.string().uuid();
export type CommandRunnerUtilityGeneration = z.infer<
  typeof CommandRunnerUtilityGenerationSchema
>;

const CommandRunnerUtilityMessageIdSchema = z.number().int().nonnegative().safe();

const CommandRunnerUtilityMessageEnvelopeSchema = z.object({
  kind: z.literal('command_runner_utility_message'),
  generation: CommandRunnerUtilityGenerationSchema,
  transport_message_id: CommandRunnerUtilityMessageIdSchema,
  payload: z.unknown(),
}).strict();

const CommandRunnerUtilityAcknowledgementEnvelopeSchema = z.object({
  kind: z.literal('command_runner_utility_ack'),
  generation: CommandRunnerUtilityGenerationSchema,
  transport_message_id: CommandRunnerUtilityMessageIdSchema,
}).strict();

export const CommandRunnerUtilityEnvelopeSchema = z.discriminatedUnion('kind', [
  CommandRunnerUtilityMessageEnvelopeSchema,
  CommandRunnerUtilityAcknowledgementEnvelopeSchema,
]);
export type CommandRunnerUtilityEnvelope = z.infer<
  typeof CommandRunnerUtilityEnvelopeSchema
>;

const CommandRunnerUtilityHostPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('command_runner_request'),
    request: z.unknown(),
  }).strict(),
  z.object({
    kind: z.literal('command_runner_owner_end'),
  }).strict(),
]);
export type CommandRunnerUtilityHostPayload = z.infer<
  typeof CommandRunnerUtilityHostPayloadSchema
>;

const CommandRunnerUtilityChildPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('command_runner_ready'),
  }).strict(),
  z.object({
    kind: z.literal('command_runner_event'),
    event: z.unknown(),
  }).strict(),
]);
export type CommandRunnerUtilityChildPayload = z.infer<
  typeof CommandRunnerUtilityChildPayloadSchema
>;

export function parseCommandRunnerUtilityGeneration(
  value: unknown,
): CommandRunnerUtilityGeneration {
  return CommandRunnerUtilityGenerationSchema.parse(value);
}

export function parseCommandRunnerUtilityEnvelope(
  value: unknown,
): CommandRunnerUtilityEnvelope {
  return CommandRunnerUtilityEnvelopeSchema.parse(value);
}

export function parseCommandRunnerUtilityHostPayload(
  value: unknown,
): CommandRunnerUtilityHostPayload {
  return CommandRunnerUtilityHostPayloadSchema.parse(value);
}

export function parseCommandRunnerUtilityChildPayload(
  value: unknown,
): CommandRunnerUtilityChildPayload {
  return CommandRunnerUtilityChildPayloadSchema.parse(value);
}
