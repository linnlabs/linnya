import { z } from 'zod';

/** 受管图片跨进程只传身份、媒体事实与内存字节，不暴露本机路径。 */
export const DocumentImageAssetSchema = z.object({
  assetId: z.string().min(1),
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  byteLength: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  dataUri: z.string().regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/),
}).strict();
export type DocumentImageAsset = z.infer<typeof DocumentImageAssetSchema>;
