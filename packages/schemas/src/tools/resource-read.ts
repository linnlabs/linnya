import { z } from 'zod';

/** 历史 resource_read 事件的完整参数合同；仅供 replay/projector admission。 */
export const HistoricalResourceReadArgsSchema = z.object({
  uri: z.string().trim().min(1),
  offset: z.number().int().optional(),
  limit: z.number().int().optional(),
  view: z.enum(['full', 'overview']).optional(),
  variant: z.enum(['preview', 'base']).optional(),
  range: z.string().optional(),
}).strict();

export type HistoricalResourceReadArgs = z.infer<typeof HistoricalResourceReadArgsSchema>;

/** 历史 Resource 图片事件的 replay admission；live Resource 已不再读取图片。 */
const HistoricalResourceImageUriSchema = z.string().trim().min(1);

export const HistoricalResourceImageReadDataSchema = z.object({
  uri: HistoricalResourceImageUriSchema,
  resource_type: z.literal('image'),
  relative_path: z.string().trim().min(1).optional(),
  file_name: z.string().trim().min(1).optional(),
}).strict();

/** 历史 resource_read 图片事件的 Renderer replay 结果合同。 */
export const HistoricalResourceImageReadResultSchema = z.object({
  data: HistoricalResourceImageReadDataSchema,
  observation: z.string().trim().min(1),
}).strict();

export type HistoricalResourceImageReadData = z.infer<typeof HistoricalResourceImageReadDataSchema>;
export type HistoricalResourceImageReadResult = z.infer<typeof HistoricalResourceImageReadResultSchema>;
