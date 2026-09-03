import { z } from 'zod';

import { CommandProcessHandleSchema } from './commandIdentity';
import { ProcessControlActionV1Schema } from './processControl';

/**
 * Agent 只能选择 opaque handle 和一个控制动作。conversation/run/tool-call/generation
 * 都由 host 从当前 ToolContext 补齐，不能成为模型可伪造的参数。
 */
export const ProcessToolArgumentsV1Schema = z.object({
  process_handle: CommandProcessHandleSchema,
  action: ProcessControlActionV1Schema,
}).strict();
export type ProcessToolArgumentsV1 = z.infer<typeof ProcessToolArgumentsV1Schema>;

export function parseProcessToolArguments(value: unknown): ProcessToolArgumentsV1 {
  return ProcessToolArgumentsV1Schema.parse(value);
}
