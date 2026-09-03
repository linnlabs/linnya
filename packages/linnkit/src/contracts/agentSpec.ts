import { z } from 'zod';
import { AgentSpecContextPolicy } from './contextPolicy';

const JsonRecord = z.record(z.string(), z.unknown());

/**
 * 工具参数 schema 在 AgentSpec 里是可序列化契约，不是运行时 zod 对象。
 * 这里主动拦截 zod-like 对象，避免把 `z.any()` 一类实现细节混进协议层。
 */
const ToolArgsSchemaSpec = JsonRecord.superRefine((value, ctx) => {
  const parse = value['parse'];
  const safeParse = value['safeParse'];
  const definition = value['_def'];
  if (typeof parse === 'function' && typeof safeParse === 'function' && definition !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'argsSchema must be a serializable record, not a runtime zod schema',
    });
  }
});

export const AgentCapability = z.string().min(1);
export type AgentCapability = z.infer<typeof AgentCapability>;

export const ToolBindingSpec = z.object({
  toolId: z.string().min(1),
  bindingId: z.string().min(1).optional(),
  argsSchema: ToolArgsSchemaSpec.optional(),
  config: JsonRecord.optional(),
  metadata: JsonRecord.optional(),
});
export type ToolBindingSpec = z.infer<typeof ToolBindingSpec>;

export const AgentSpecAuditConfig = z.object({
  redactionLevel: z.enum(['none', 'standard', 'strict']).optional(),
  pii: z.boolean().optional(),
});
export type AgentSpecAuditConfig = z.infer<typeof AgentSpecAuditConfig>;

export const AgentSpec = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  role: z.string().optional(),
  description: z.string().optional(),
  capabilities: z.array(AgentCapability),
  tools: z.array(ToolBindingSpec),
  contextPolicy: AgentSpecContextPolicy,
  audit: AgentSpecAuditConfig.optional(),
  metadata: JsonRecord.optional(),
});
export type AgentSpec = z.infer<typeof AgentSpec>;
