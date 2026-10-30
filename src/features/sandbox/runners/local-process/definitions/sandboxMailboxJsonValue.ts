import { z } from 'zod';
import type { SandboxJsonValue } from '../../../types.js';
import { readSandboxMailboxJsonValue } from '../functions/readSandboxMailboxJsonValue.js';

export type SandboxMailboxJsonReadResult =
  | { readonly valid: true; readonly value: SandboxJsonValue }
  | { readonly valid: false };

/** 保留 strict DTO 外层校验和 JSON 深拷贝，避免递归 union 的分支错误分配。 */
export const SandboxMailboxJsonValueSchema = z.unknown().transform((value, context): SandboxJsonValue => {
  const result = readSandboxMailboxJsonValue(value);
  if (result.valid) return result.value;
  context.addIssue({ code: z.ZodIssueCode.custom, message: 'Sandbox mailbox value must contain finite JSON values' });
  return z.NEVER;
});
