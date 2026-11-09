import fs from 'node:fs/promises';
import sharp from 'sharp';
import type { PluginSqliteDatabaseLike } from '@linnya/plugin-host-contract/backend/workspaceRuntime';
import type { MarkdownPreviewResources } from 'src/domains/markdown';
import { createDocumentImageAssetRuntime, readDocumentImageAssetLimits } from 'src/plugin-sdk/backend/documentImageAsset';
import { resolveDocumentReference } from 'src/plugin-sdk/backend/documentReferences';
import { getDocumentTypeBackendHook } from 'src/plugin-sdk/backend/documentTypeBackendHook';
import { resolveDocumentMediaDirForNode } from 'src/shared/utils/pathManager';
import { resolveDocImageInputPath } from 'src/features/system/media/functions/resolveDocImageInputPath';

/** 仅消费两种正式图片身份；不 fetch 任意 URL，也不为预览注册资产或写媒体文件。 */
export function createMarkdownPreviewResources(db: PluginSqliteDatabaseLike): MarkdownPreviewResources {
  const managed = createDocumentImageAssetRuntime(db);
  const limits = readDocumentImageAssetLimits();
  return {
    readReference(input) {
      const result = resolveDocumentReference(db, input);
      return { documentId: result.targetDocumentId, title: result.title, nodeType: result.nodeType,
        status: result.status === 'available' && result.nodeType !== 'document' && !getDocumentTypeBackendHook(result.nodeType ?? '') ? 'plugin_unavailable' : result.status };
    },
    async readImage({ documentId, image, signal }) {
      signal?.throwIfAborted();
      let bytes: Buffer;
      if (image.assetId) {
        const asset = await managed.readOwnedImage({ documentId, assetId: image.assetId });
        bytes = Buffer.from(asset.dataUri.slice(asset.dataUri.indexOf(',') + 1), 'base64');
      } else {
        const locator = /^media:\/\/load\/doc-image\/([A-Za-z0-9_-]+)$/.exec(image.src);
        // 无正式来源的空图片仍保留在正文，由统一 renderer 呈现缺图状态。
        if (!locator) return null;
        const relativePath = Buffer.from(locator[1], 'base64url').toString('utf8');
        const filePath = await resolveDocImageInputPath(relativePath, resolveDocumentMediaDirForNode(documentId));
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size > limits.maxImageBytes) throw new Error('Document preview image exceeds admitted media limits');
        bytes = await fs.readFile(filePath, { signal });
      }
      signal?.throwIfAborted();
      // 首帧静态光栅化保留透明度，最长边有界，避免一百张文档卡内联一百份原图。
      const pipeline = sharp(bytes, { failOn: 'error', limitInputPixels: limits.maxImagePixels }).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true });
      const metadata = await sharp(bytes, { limitInputPixels: limits.maxImagePixels }).metadata();
      const format = metadata.format === 'jpeg' ? 'jpeg' : metadata.format === 'webp' ? 'webp' : 'png';
      const output = await pipeline.toFormat(format).toBuffer();
      signal?.throwIfAborted();
      return `data:image/${format};base64,${output.toString('base64')}`;
    },
  };
}
