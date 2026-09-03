import { z } from 'zod';

import { ToolOutputBlobIdSchema } from './tool-output-read';

const NonEmptyStringSchema = z.string().trim().min(1);

function requireUniqueStrings(
  items: readonly string[],
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: 'items must be unique',
      });
      return;
    }
    seen.add(item);
  });
}

export const SubagentArgsSchema = z.object({
  description: NonEmptyStringSchema,
  prompt: NonEmptyStringSchema,
  /** 具体 enum 由启用插件的 subagent registry 在 Tool JSON Schema 中动态收窄。 */
  subagent_type: NonEmptyStringSchema.optional(),
}).strict();

export const SubagentStatusSchema = z.enum([
  'completed',
  'partial',
  'failed',
  'cancelled',
]);

export const SubagentWorkspaceArtifactRefSchema = z.string().trim().regex(
  /^workspace:[A-Za-z0-9][A-Za-z0-9._-]*$/,
  'Subagent Workspace artifact must use workspace:<inode>',
);

export const SubagentToolOutputArtifactRefSchema = z.string().trim().superRefine(
  (value, context) => {
    const prefix = 'tool_output://blobs/';
    if (!value.startsWith(prefix)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Subagent ToolOutput artifact must use tool_output://blobs/<blob_id>',
      });
      return;
    }
    const parsedBlobId = ToolOutputBlobIdSchema.safeParse(value.slice(prefix.length));
    if (!parsedBlobId.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Subagent ToolOutput artifact contains an invalid blob_id',
      });
    }
  },
);

/**
 * 子 Agent 可交还给父 Agent 的正式产物身份。
 *
 * SharedMemory、Evidence 和任意 Resource URI 都不是协作产物；它们不能通过扩大
 * 这个联合重新混入 live 工具结果。
 */
export const SubagentArtifactRefSchema = z.union([
  SubagentWorkspaceArtifactRefSchema,
  SubagentToolOutputArtifactRefSchema,
]);

const UniqueSubagentArtifactRefsSchema = z.array(SubagentArtifactRefSchema)
  .superRefine(requireUniqueStrings);
const SingleSubrunIdSchema = z.array(NonEmptyStringSchema)
  .length(1)
  .superRefine(requireUniqueStrings);

export const SubagentResultSchema = z.object({
  data: z.object({
    description: NonEmptyStringSchema,
    subagent_type: NonEmptyStringSchema,
    /** child run 启动时锁定的 Host 模型身份，供父 Agent 与只读详情展示同一执行事实。 */
    model_id: NonEmptyStringSchema,
    /** 单次 subagent 当前只创建一个 child；数组形状与 Conversation 权威顺序协议一致。 */
    subrun_ids: SingleSubrunIdSchema,
    status: SubagentStatusSchema,
    final_answer: z.string(),
    artifacts: UniqueSubagentArtifactRefsSchema,
    last_progress: NonEmptyStringSchema.optional(),
    error: NonEmptyStringSchema.optional(),
  }).strict(),
  observation: NonEmptyStringSchema,
}).strict();

export type SubagentArgs = z.infer<typeof SubagentArgsSchema>;
export type SubagentStatus = z.infer<typeof SubagentStatusSchema>;
export type SubagentArtifactRef = z.infer<typeof SubagentArtifactRefSchema>;
export type SubagentResult = z.infer<typeof SubagentResultSchema>;

export function parseSubagentResult(value: unknown): SubagentResult {
  return SubagentResultSchema.parse(value);
}
