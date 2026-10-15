import { z } from 'zod';

/** 自定义 API 分组保存连接归属，空模型列表不结束连接与凭据的生命周期。 */
export const CustomApiGroupSchema = z
  .object({
    name: z.string().trim().min(1),
    inference_endpoint_ids: z
      .array(z.string().trim().min(1))
      .min(1)
      .refine(
        ids => new Set(ids).size === ids.length,
        '自定义 API 分组不能重复引用 InferenceEndpoint'
      )
      .readonly(),
  })
  .strict()
  .readonly();

export type CustomApiGroup = z.infer<typeof CustomApiGroupSchema>;

/** App 在正式 Provider membership 恢复后明确交付旧模型归属，Catalog 不猜测 Provider。 */
export interface CustomApiGroupMigration {
  readonly name: string;
  readonly model_ids: readonly string[];
}
