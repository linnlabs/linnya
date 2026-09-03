import { z } from 'zod';

export const WriteToTableArgsSchema = z.object({
  content: z.string().min(1),
  mode: z.enum(['replace', 'append']).default('append'),
  row: z.number().int().nonnegative().optional(),
  col: z.number().int().nonnegative().optional(),
}).strict();
export type WriteToTableArgs = z.infer<typeof WriteToTableArgsSchema>;

export const WriteToTableDataSchema = z.object({
  action: z.literal('write_to_table'),
  content: z.string().min(1),
  mode: z.enum(['replace', 'append']),
  row: z.number().int().nonnegative().optional(),
  col: z.number().int().nonnegative().optional(),
  timestamp: z.number().int().nonnegative(),
}).strict();

const WriteToTableControlSchema = z.object({
  terminateRun: z.literal(true),
  finalAnswer: z.string().min(1),
  reason: z.string().min(1).optional(),
}).strict();

export const WriteToTableOutputSchema = z.object({
  data: WriteToTableDataSchema,
  observation: z.string().trim().min(1),
  control: WriteToTableControlSchema,
}).strict().superRefine((value, context) => {
  if (value.control.finalAnswer !== value.data.content) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['control', 'finalAnswer'],
      message: 'write_to_table finalAnswer must equal content',
    });
  }
});

/** ToolNode 消费 control 后持久化的稳定结果合同。 */
export const WriteToTableReplayResultSchema = z.object({
  data: WriteToTableDataSchema,
  observation: z.string().trim().min(1),
}).strict();

export type WriteToTableData = z.infer<typeof WriteToTableDataSchema>;
export type WriteToTableOutput = WriteToTableData & {
  readonly control: z.infer<typeof WriteToTableControlSchema>;
};
export type WriteToTableReplayResult = z.infer<typeof WriteToTableReplayResultSchema>;

/** 读取工具 wire output；实时 SSE 中该值是 JSON 字符串，测试与持久化投影也可直接给对象。 */
export function readWriteToTableOutput(value: unknown): WriteToTableOutput | null {
  let candidate = value;
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }

  const result = WriteToTableOutputSchema.safeParse(candidate);
  return result.success
    ? { ...result.data.data, control: result.data.control }
    : null;
}

export function readWriteToTableReplayResult(value: unknown): WriteToTableReplayResult | null {
  const result = WriteToTableReplayResultSchema.safeParse(value);
  return result.success ? result.data : null;
}
