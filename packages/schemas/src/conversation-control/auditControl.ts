import { z } from 'zod';

/** CLI 与 Host 交换的审计档位；记录规则仍由 Audit domain 拥有。 */
export const ConversationControlAuditLevelSchema = z.enum([
  'off',
  'behavior',
  'response',
  'stream',
]);

export const ConversationControlAuditLevelRequestSchema = z
  .object({
    schema_version: z.literal(1),
    command: z.literal('audit_level'),
    level: ConversationControlAuditLevelSchema.optional(),
  })
  .strict();

export const ConversationControlAuditLevelResponseSchema = z
  .object({
    schema_version: z.literal(1),
    ok: z.literal(true),
    command: z.literal('audit_level'),
    level: ConversationControlAuditLevelSchema,
  })
  .strict();

export const ConversationControlInstanceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('source'),
      source_root: z.string().min(1),
      branch: z.string().min(1).nullable(),
      audit_level: ConversationControlAuditLevelSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('packaged'),
      source_root: z.null(),
      branch: z.null(),
      audit_level: z.literal('off'),
    })
    .strict(),
]);

/** 未连接时没有实时档位；不得把文件中的旧值或 off 冒认为实例当前状态。 */
export const ConversationControlConnectionContextSchema = z
  .object({
    source_root: z.string().min(1).nullable(),
    branch: z.string().min(1).nullable(),
    state: z.enum(['not_connected', 'connected', 'rejected']),
    instance: ConversationControlInstanceSchema.nullable(),
  })
  .strict();

export type ConversationControlAuditLevelRequest = z.infer<
  typeof ConversationControlAuditLevelRequestSchema
>;
export type ConversationControlAuditLevelResponse = z.infer<
  typeof ConversationControlAuditLevelResponseSchema
>;
export type ConversationControlInstance = z.infer<typeof ConversationControlInstanceSchema>;
export type ConversationControlConnectionContext = z.infer<
  typeof ConversationControlConnectionContextSchema
>;
