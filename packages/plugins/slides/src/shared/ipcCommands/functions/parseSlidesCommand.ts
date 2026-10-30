import * as z from 'zod';
import { SlidesIpcError } from '../../ipc';

/** 前后端共享错误类别和显示语言，避免前置校验与 IPC 校验给出两套结果。 */
export function parseSlidesCommand<T>(
  schema: z.ZodType<T, unknown>,
  payload: unknown
): T {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;
  const fields = result.error.issues.map(issue => issue.path.join('.')).filter(Boolean);
  throw new SlidesIpcError(`请求参数无效：${fields.join('、') || 'payload'}`, 'validation', false);
}
