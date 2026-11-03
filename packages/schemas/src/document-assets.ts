import { z } from 'zod';
/** 文档资产预算只暴露已登记的字节事实，不携带物理路径或文件能力。 */
export const DocumentAssetByteFactSchema = z.object({ assetId: z.string().min(1), byteLength: z.number().int().nonnegative().safe() }).strict();
export const DocumentAssetByteFactsSchema = z.array(DocumentAssetByteFactSchema);
export type DocumentAssetByteFact = z.infer<typeof DocumentAssetByteFactSchema>;
