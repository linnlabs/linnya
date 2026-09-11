import { z } from 'zod';
import {
  AgentSpec,
  RunIdSchema,
  SerializableJsonRecord,
  type RoutedRuntimeEvent,
} from '@linnlabs/linnkit/contracts';
import { ConversationOptions } from '@app/schemas';
import { CommandRunPermissionSnapshotV1Schema } from '@app/schemas/commands';
import { AgentInvokeRequestSchema } from '../../../context/agent/schemas';

const CommandRunPermissionContextSchema = z.discriminatedUnion('status', [
  z
    .object({ status: z.literal('available'), snapshot: CommandRunPermissionSnapshotV1Schema })
    .strict(),
  z
    .object({
      status: z.literal('unavailable'),
      code: z.literal('permission_settings_unavailable'),
      reason: z.enum(['invalid_config', 'read_failed', 'run_snapshot_missing']),
    })
    .strict(),
]);

/** 只有非秘密、可重建的原运行输入；游标与累计预算仍归 Checkpoint / RunRegistry。 */
export const RunDescriptorSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: RunIdSchema,
    conversationId: z.string().min(1),
    turnId: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
    child: z
      .object({
        parentRunId: RunIdSchema,
        parentToolCallId: z.string().min(1),
        subrunId: z.string().min(1),
      })
      .strict()
      .optional(),
    agentSpec: AgentSpec,
    request: AgentInvokeRequestSchema,
    options: ConversationOptions.optional(),
    historyEventIds: z.array(z.string().min(1)),
    incomingEventIds: z.array(z.string().min(1)),
    runContext: z
      .object({
        runId: RunIdSchema,
        traceId: z.string().min(1),
        parentId: RunIdSchema.optional(),
        rootRunId: RunIdSchema.optional(),
        tags: z.record(z.union([z.string(), z.number(), z.boolean()])),
      })
      .strict(),
    toolContextPatch: SerializableJsonRecord,
    executorLocal: SerializableJsonRecord,
    commandPermission: CommandRunPermissionContextSchema,
    compatibility: z
      .object({
        hostVersion: z.string().min(1),
        frameworkVersion: z.string().min(1),
        agentConfiguration: SerializableJsonRecord,
        models: z.record(SerializableJsonRecord),
        plugins: z.array(z.object({ id: z.string().min(1), version: z.string().min(1) }).strict()),
        skills: z.record(z.string().regex(/^[a-f0-9]{64}$/)),
      })
      .strict(),
  })
  .strict()
  .superRefine((descriptor, context) => {
    if (descriptor.runContext.runId !== descriptor.runId) {
      context.addIssue({
        code: 'custom',
        path: ['runContext', 'runId'],
        message: 'Run context identity mismatch',
      });
    }
    if (descriptor.request.frozenSystemPrompt === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['request'],
        message: 'Missing frozen system prompt',
      });
    }
  });

export type RunDescriptor = z.infer<typeof RunDescriptorSchema>;

export interface RunDescriptorStore {
  /** 首次插入，不允许用“最新配置”覆盖原输入。 */
  insert(descriptor: RunDescriptor): Promise<void>;
  load(runId: string): Promise<RunDescriptor | null>;
  exists(runId: string): Promise<boolean>;
  hasCommittedCheckpoint(runId: string): Promise<boolean>;
  loadEvents(conversationId: string, eventIds: readonly string[]): Promise<RoutedRuntimeEvent[]>;
  loadInputs(
    descriptor: RunDescriptor
  ): Promise<{ history: RoutedRuntimeEvent[]; newEvents: RoutedRuntimeEvent[] }>;
  remove(runId: string): Promise<void>;
}
