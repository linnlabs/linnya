import { z } from 'zod';

export const TASK_STATE_MAX_SERIALIZED_CHARS = 8_000;
export const TASK_STATE_GOAL_MAX_LENGTH = 500;
export const TASK_STATE_ITEM_MAX_LENGTH = 1_000;
export const TASK_STATE_PROGRESS_MAX_LENGTH = 3_000;
export const TASK_STATE_REFERENCE_MAX_LENGTH = 2_048;
export const TASK_STATE_CONSTRAINTS_MAX_ITEMS = 10;
export const TASK_STATE_PLAN_MAX_ITEMS = 7;
export const TASK_STATE_NEXT_STEPS_MAX_ITEMS = 6;
export const TASK_STATE_REFERENCES_MAX_ITEMS = 20;

const NonEmptyStringSchema = z.string().trim().min(1);
const GoalSchema = NonEmptyStringSchema.max(TASK_STATE_GOAL_MAX_LENGTH);
const ItemSchema = NonEmptyStringSchema.max(TASK_STATE_ITEM_MAX_LENGTH);
const ProgressSchema = NonEmptyStringSchema.max(TASK_STATE_PROGRESS_MAX_LENGTH);
const ReferenceSchema = NonEmptyStringSchema.max(TASK_STATE_REFERENCE_MAX_LENGTH);

export const TaskStatePhaseSchema = z.enum(['plan', 'execute', 'verify', 'recover']);
export type TaskStatePhase = z.infer<typeof TaskStatePhaseSchema>;

function requireUniqueItems(items: readonly string[], context: z.RefinementCtx): void {
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

function requireTaskStateBudget(value: object, context: z.RefinementCtx): void {
  const serializedLength = JSON.stringify(value).length;
  if (serializedLength > TASK_STATE_MAX_SERIALIZED_CHARS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `TaskState exceeds the ${TASK_STATE_MAX_SERIALIZED_CHARS}-character serialized budget`,
    });
  }
}

const ConstraintsSchema = z.array(ItemSchema)
  .max(TASK_STATE_CONSTRAINTS_MAX_ITEMS)
  .superRefine(requireUniqueItems);
const PlanSchema = z.array(ItemSchema)
  .min(1)
  .max(TASK_STATE_PLAN_MAX_ITEMS)
  .superRefine(requireUniqueItems);
const NextStepsSchema = z.array(ItemSchema)
  .min(1)
  .max(TASK_STATE_NEXT_STEPS_MAX_ITEMS)
  .superRefine(requireUniqueItems);
const ReferencesSchema = z.array(ReferenceSchema)
  .min(1)
  .max(TASK_STATE_REFERENCES_MAX_ITEMS)
  .superRefine(requireUniqueItems);

/**
 * TaskState 的唯一结构化合同。
 *
 * 中文说明：Markdown 只是宿主当前选择的存储格式，不属于工具结果合同。所有程序化
 * 消费者只能读取本结构，禁止从 observation 或 Markdown 反推 TaskState。
 */
export const TaskStateSchema = z.object({
  goal: GoalSchema,
  constraints: ConstraintsSchema,
  current_phase: TaskStatePhaseSchema,
  current_plan: PlanSchema,
  progress: ProgressSchema,
  next_steps: NextStepsSchema,
  references: ReferencesSchema,
}).strict().superRefine(requireTaskStateBudget);

export type TaskState = z.infer<typeof TaskStateSchema>;

/** 仅用于旧事件回放；历史事实不受新增 live 预算反向约束。 */
export const HistoricalTaskStateSchema = z.object({
  goal: NonEmptyStringSchema,
  constraints: z.array(NonEmptyStringSchema).superRefine(requireUniqueItems),
  current_phase: TaskStatePhaseSchema,
  current_plan: z.array(NonEmptyStringSchema).min(1).superRefine(requireUniqueItems),
  progress: NonEmptyStringSchema,
  next_steps: z.array(NonEmptyStringSchema).min(1).superRefine(requireUniqueItems),
  references: z.array(NonEmptyStringSchema).min(1).superRefine(requireUniqueItems),
}).strict();

export const TaskStateWriteArgsSchema = z.object({
  goal: GoalSchema,
  constraints: ConstraintsSchema.optional(),
  current_phase: TaskStatePhaseSchema,
  current_plan: PlanSchema,
  progress: ProgressSchema,
  next_steps: NextStepsSchema,
  references: ReferencesSchema,
}).strict().superRefine(requireTaskStateBudget);

export const TaskStateReadArgsSchema = z.object({}).strict();
export const TaskStateToolArgsSchema = z.union([
  TaskStateWriteArgsSchema,
  TaskStateReadArgsSchema,
]);

export type TaskStateWriteArgs = z.infer<typeof TaskStateWriteArgsSchema>;
export type TaskStateReadArgs = z.infer<typeof TaskStateReadArgsSchema>;
export type TaskStateToolArgs = z.infer<typeof TaskStateToolArgsSchema>;

export const TaskStateWriteDataSchema = z.object({
  operation: z.enum(['create', 'update']),
  version: z.number().int().positive(),
  taskstate: TaskStateSchema,
}).strict();

export const TaskStateReadMissingDataSchema = z.object({
  exists: z.literal(false),
}).strict();

export const TaskStateReadExistingDataSchema = z.object({
  exists: z.literal(true),
  version: z.number().int().positive(),
  taskstate: TaskStateSchema,
}).strict();

export const TaskStateWriteResultSchema = z.object({
  data: TaskStateWriteDataSchema,
  observation: NonEmptyStringSchema,
}).strict();

export const TaskStateReadResultSchema = z.object({
  data: z.discriminatedUnion('exists', [
    TaskStateReadMissingDataSchema,
    TaskStateReadExistingDataSchema,
  ]),
  observation: NonEmptyStringSchema,
}).strict();

export const TaskStateToolResultSchema = z.union([
  TaskStateWriteResultSchema,
  TaskStateReadResultSchema,
]);

const HistoricalTaskStateLocationFields = {
  conversation_id: NonEmptyStringSchema,
  instance_id: NonEmptyStringSchema,
  doc_name: z.literal('TaskState'),
} as const;

export const HistoricalTaskStateWriteResultSchema = z.object({
  data: z.object({
    source: z.literal('shared_memory'),
    operation: z.enum(['create', 'update']),
    ...HistoricalTaskStateLocationFields,
    uri: NonEmptyStringSchema,
    version: z.number().int().positive(),
    taskstate: HistoricalTaskStateSchema,
  }).strict(),
  observation: NonEmptyStringSchema,
}).strict();

export const HistoricalTaskStateReadResultSchema = z.object({
  data: z.discriminatedUnion('exists', [
    z.object({
      exists: z.literal(false),
      ...HistoricalTaskStateLocationFields,
    }).strict(),
    z.object({
      exists: z.literal(true),
      ...HistoricalTaskStateLocationFields,
      uri: NonEmptyStringSchema,
      version: z.number().int().positive(),
      taskstate: HistoricalTaskStateSchema,
    }).strict(),
  ]),
  observation: NonEmptyStringSchema,
}).strict();

export type HistoricalTaskStateWriteResult = z.infer<typeof HistoricalTaskStateWriteResultSchema>;
export type HistoricalTaskStateReadResult = z.infer<typeof HistoricalTaskStateReadResultSchema>;

export type TaskStateWriteData = z.infer<typeof TaskStateWriteDataSchema>;
export type TaskStateReadData = z.infer<typeof TaskStateReadResultSchema>['data'];
export type TaskStateWriteResult = z.infer<typeof TaskStateWriteResultSchema>;
export type TaskStateReadResult = z.infer<typeof TaskStateReadResultSchema>;
export type TaskStateToolResult = z.infer<typeof TaskStateToolResultSchema>;

export function parseTaskStateToolResult(value: unknown): TaskStateToolResult {
  return TaskStateToolResultSchema.parse(value);
}
