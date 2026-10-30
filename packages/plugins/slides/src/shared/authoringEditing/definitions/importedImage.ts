import * as z from 'zod';

/** 图片接管返回已校验的资产身份和像素尺寸，不传回字节或宿主路径。 */
export const SlidesImportedImageSchema = z.object({
  assetId: z.string().min(1), width: z.number().int().positive(), height: z.number().int().positive(),
}).strict();
export type SlidesImportedImage = z.infer<typeof SlidesImportedImageSchema>;
