import { z } from 'zod';

/** 跨进程 DTO 可接受的 JSON 值；禁止 undefined、函数、Date 与类实例。 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(JsonValueSchema),
  z.record(JsonValueSchema),
]));

export const JsonRecordSchema = z.record(JsonValueSchema);
export type JsonRecord = z.infer<typeof JsonRecordSchema>;
