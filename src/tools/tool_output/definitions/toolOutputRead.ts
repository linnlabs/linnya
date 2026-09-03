import { z } from 'zod';
import { ToolOutputBlobIdSchema } from '@app/schemas';

export const TOOL_OUTPUT_READ_DEFAULT_CHARS = 6_000;
export const TOOL_OUTPUT_READ_MAX_CHARS = 9_000;
export const TOOL_OUTPUT_READ_MAX_LINES = 300;
export const TOOL_OUTPUT_READ_MAX_UNITS = 1_200;

/** ToolOutput 续读只接受字符 offset；旧的行 cursor 不属于当前合同。 */
export const ToolOutputReadArgsSchema = z.object({
  blob_id: ToolOutputBlobIdSchema,
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().positive().max(TOOL_OUTPUT_READ_MAX_CHARS).default(TOOL_OUTPUT_READ_DEFAULT_CHARS),
}).strict();

export type ToolOutputReadArgs = z.infer<typeof ToolOutputReadArgsSchema>;
