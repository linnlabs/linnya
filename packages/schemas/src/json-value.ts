import { z } from 'zod';

/** 跨进程 DTO 可接受的 JSON 值；禁止 undefined、函数、Date 与类实例。 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// lazy 只解开递归引用；不能在每个 JSON 节点上重新创建 union 和六种子 schema。
// RPC 会校验完整文档，重复构造会把轻量 preview 读取放大成主线程长任务。
export const JsonValueSchema: z.ZodType<JsonValue, JsonValue> = z.lazy(() => JsonValueUnionSchema);

const JsonValueUnionSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
]);

export const JsonRecordSchema = z.record(z.string(), JsonValueSchema);
export type JsonRecord = z.infer<typeof JsonRecordSchema>;
