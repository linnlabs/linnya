import { z } from 'zod';

// models.dev 同一 API 也收录图像、音频等非 language 模型，容量会合法地写成 0。
// 是否进入 Linnya language catalog 由 admission 函数判断，source reader 不伪造容量。
const NonNegativeSafeIntegerSchema = z.number().int().nonnegative().safe();

const ModelsDevModelSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    family: z.string().trim().min(1).optional(),
    release_date: z.string().trim().min(1).optional(),
    status: z.enum(['beta', 'deprecated']).optional(),
    attachment: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    tool_call: z.boolean().optional(),
    modalities: z
      .object({
        input: z.array(z.string().trim().min(1)).optional(),
        output: z.array(z.string().trim().min(1)).optional(),
      })
      .passthrough()
      .optional(),
    limit: z
      .object({
        context: NonNegativeSafeIntegerSchema,
        input: NonNegativeSafeIntegerSchema.optional(),
        output: NonNegativeSafeIntegerSchema,
      })
      .passthrough(),
  })
  .passthrough();

const ModelsDevProviderSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    npm: z.string().trim().min(1),
    api: z.string().trim().min(1).optional(),
    models: z.record(z.string().trim().min(1), ModelsDevModelSchema),
  })
  .passthrough();

export const ModelsDevSourceSchema = z.record(
  z.string().trim().min(1),
  ModelsDevProviderSchema
);

export type ModelsDevSource = z.infer<typeof ModelsDevSourceSchema>;
export type ModelsDevProvider = z.infer<typeof ModelsDevProviderSchema>;
export type ModelsDevModel = z.infer<typeof ModelsDevModelSchema>;
