import { z } from 'zod';
import { CanvasTagIdSchema } from '../../model/definitions/canvasElement';

/** 工作区标签的当前身份；画布只把 ID 存进卡片，名称每次从 Host 读。 */
export const CanvasTagNameSchema = z
  .object({ id: CanvasTagIdSchema, name: z.string().min(1) })
  .strict();
export const CanvasTagsRequestSchema = z
  .object({ ids: z.array(CanvasTagIdSchema).max(5000) })
  .strict();
export const CanvasTagsResultSchema = z
  .object({
    /** 工作区里现有的全部标签，供界面挑选。 */
    tags: z.array(CanvasTagNameSchema),
    /** 卡片上存的 ID 对应的当前标签：已合并的给合并目标，已删除的不出现。 */
    resolved: z.record(z.string(), CanvasTagNameSchema),
  })
  .strict();
export type CanvasTagName = z.infer<typeof CanvasTagNameSchema>;
export type CanvasTagsResult = z.infer<typeof CanvasTagsResultSchema>;
/** 卡片上存的标签 ID → 当前标签。 */
export type CanvasTagNames = ReadonlyMap<string, CanvasTagName>;
