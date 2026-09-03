import { z } from 'zod';

const NonEmptyExactStringSchema = z.string()
  .min(1)
  .refine(value => value === value.trim(), 'value must not contain leading or trailing whitespace');

export const AgentTodoToolStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'cancelled',
]);

export const AgentTodoToolItemSchema = z.object({
  id: NonEmptyExactStringSchema,
  content: NonEmptyExactStringSchema,
  status: AgentTodoToolStatusSchema,
}).strict();

const AgentTodoToolItemsSchema = z.array(AgentTodoToolItemSchema).superRefine((items, context) => {
  const ids = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (ids.has(item.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'id'],
        message: 'todo item id must be unique within one result',
      });
    }
    ids.add(item.id);
  }
});

export const EmptyAgentTodoToolDataSchema = z.object({
  todo_list_id: z.null(),
  version: z.literal(0),
  items: z.tuple([]),
}).strict();

export const ActiveAgentTodoToolDataSchema = z.object({
  todo_list_id: NonEmptyExactStringSchema,
  version: z.number().int().positive(),
  items: AgentTodoToolItemsSchema,
}).strict();

/**
 * Linnya todo_read/todo_write 的唯一 wire result。
 * Todo 是普通工具语义；Linnkit Runtime 不理解、不发布、不投影该状态。
 */
export const AgentTodoToolDataSchema = z.union([
  EmptyAgentTodoToolDataSchema,
  ActiveAgentTodoToolDataSchema,
]);

export const AgentTodoToolResultSchema = z.object({
  data: AgentTodoToolDataSchema,
  observation: z.string().min(1),
}).strict();

/** todo_write 成功后必须产生活跃快照；空状态只属于尚未写入时的 todo_read。 */
export const AgentTodoWriteResultSchema = z.object({
  data: ActiveAgentTodoToolDataSchema,
  observation: z.string().min(1),
}).strict();

export type AgentTodoToolItem = z.infer<typeof AgentTodoToolItemSchema>;
export type AgentTodoToolStatus = z.infer<typeof AgentTodoToolStatusSchema>;
export type AgentTodoToolData = z.infer<typeof AgentTodoToolDataSchema>;
export type AgentTodoToolResult = z.infer<typeof AgentTodoToolResultSchema>;
export type AgentTodoWriteResult = z.infer<typeof AgentTodoWriteResultSchema>;
