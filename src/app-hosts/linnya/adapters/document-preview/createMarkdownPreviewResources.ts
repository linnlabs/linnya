import fs from 'node:fs/promises';
import sharp from 'sharp';
import type { PluginSqliteDatabaseLike } from '@linnya/plugin-host-contract/backend/workspaceRuntime';
import type { DocumentPreviewImageResult } from '@app/schemas';
import { createSqliteDocumentAssetOwnership } from 'src/app-hosts/linnya/application/document-assets';
import type { PreviewImageVariantCache } from 'src/domains/document-preview';
import type { MarkdownPreviewResources } from 'src/domains/markdown';
import {
  createDocumentImageAssetRuntime,
  readDocumentImageAssetLimits,
} from 'src/plugin-sdk/backend/documentImageAsset';
import { resolveDocumentReference } from 'src/plugin-sdk/backend/documentReferences';
import { requirePluginHostDatabase } from 'src/plugin-sdk/backend/pluginHostDatabase';
import { getDocumentTypeBackendHook } from 'src/plugin-sdk/backend/documentTypeBackendHook';
import { resolveDocumentMediaDirForNode } from 'src/shared/utils/pathManager';
import { resolveDocImageInputPath } from 'src/features/system/media/functions/resolveDocImageInputPath';

const DOC_IMAGE_LOCATOR = /^media:\/\/load\/doc-image\/([A-Za-z0-9_-]+)$/;

/** 仅消费两种正式图片身份；不 fetch 任意 URL，也不为预览注册资产或写媒体文件。 */
export function createMarkdownPreviewResources(
  db: PluginSqliteDatabaseLike,
  variants: PreviewImageVariantCache
): MarkdownPreviewResources {
  const managed = createDocumentImageAssetRuntime(db);
  const ownership = createSqliteDocumentAssetOwnership(
    requirePluginHostDatabase(db, 'Document preview images')
  );
  const limits = readDocumentImageAssetLimits();
  /**
   * 受管资产按内容寻址，同一 assetId 的字节不变，所以尺寸和缩图都可以按 assetId 记住。
   * 取受管字节（readOwnedImage）每次都会校验哈希并完整解码原图，一张大图要上百毫秒；
   * 它只在第一次遇到某张图时走一次，之后的清单和缩图命中都只做归属检查。
   */
  const assetSizes = new Map<string, Promise<{ widthPx: number; heightPx: number }>>();
  const encoding = new Map<string, Promise<DocumentPreviewImageResult>>();
  function assertOwned(documentId: string, assetId: string) {
    if (!ownership.hasOwnership({ documentId, assetId }))
      throw new Error('Document preview image is not owned by the document');
  }
  async function managedBytes(documentId: string, assetId: string) {
    const asset = await managed.readOwnedImage({ documentId, assetId });
    return {
      size: { widthPx: asset.displayWidth, heightPx: asset.displayHeight },
      bytes: Buffer.from(asset.dataUri.slice(asset.dataUri.indexOf(',') + 1), 'base64'),
    };
  }
  /** 手动插入的图片必须落在该文档的私有媒体目录内；文件可以被替换，身份带上修改时间和大小。 */
  async function mediaFile(documentId: string, src: string) {
    const locator = DOC_IMAGE_LOCATOR.exec(src);
    if (!locator) throw new Error('Document preview image source is not a document media locator');
    const filePath = await resolveDocImageInputPath(
      Buffer.from(locator[1], 'base64url').toString('utf8'),
      resolveDocumentMediaDirForNode(documentId)
    );
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > limits.maxImageBytes)
      throw new Error('Document preview image exceeds admitted media limits');
    return { filePath, identity: `file:${filePath}:${stat.mtimeMs}:${stat.size}` };
  }
  return {
    readReference(input) {
      const result = resolveDocumentReference(db, input);
      return {
        documentId: result.targetDocumentId,
        title: result.title,
        nodeType: result.nodeType,
        status:
          result.status === 'available' &&
          result.nodeType !== 'document' &&
          !getDocumentTypeBackendHook(result.nodeType ?? '')
            ? 'plugin_unavailable'
            : result.status,
      };
    },
    async readImageSize({ documentId, image, signal }) {
      signal?.throwIfAborted();
      if (image.assetId) {
        const assetId = image.assetId;
        assertOwned(documentId, assetId);
        let size = assetSizes.get(assetId);
        if (!size) {
          size = managedBytes(documentId, assetId).then(asset => asset.size);
          assetSizes.set(assetId, size);
          // 失败不记住：资产恢复后下一次读取应重新尝试。
          size.catch(() => assetSizes.delete(assetId));
        }
        return size;
      }
      // 无正式来源的空图片仍保留在正文，由统一 renderer 呈现缺图状态。
      if (!DOC_IMAGE_LOCATOR.test(image.src)) return null;
      const { filePath } = await mediaFile(documentId, image.src);
      signal?.throwIfAborted();
      // 只读文件头。清单给的是用户看到的朝向（EXIF 转正后），缩图时同样会转正。
      const { autoOrient } = await sharp(filePath, {
        limitInputPixels: limits.maxImagePixels,
      }).metadata();
      return { widthPx: autoOrient.width, heightPx: autoOrient.height };
    },
    async readImageVariant({ documentId, source, maxEdgePx, signal }) {
      signal?.throwIfAborted();
      let identity: string, input: () => Promise<Buffer | string>;
      if ('assetId' in source) {
        assertOwned(documentId, source.assetId);
        identity = `asset:${source.assetId}`;
        input = async () => (await managedBytes(documentId, source.assetId)).bytes;
      } else {
        const file = await mediaFile(documentId, source.src);
        identity = file.identity;
        input = async () => file.filePath;
      }
      signal?.throwIfAborted();
      const key = JSON.stringify([identity, maxEdgePx]);
      const cached = await variants.read(key);
      if (cached) return { mimeType: `image/${cached.format}`, bytes: cached.bytes };
      // 同一张图的同一档只缩一次：悬停、画布卡和详情常在同一时刻要同一张图。
      const running = encoding.get(key);
      if (running) return running;
      const task = (async (): Promise<DocumentPreviewImageResult> => {
        const original = await input();
        const options = { failOn: 'error', limitInputPixels: limits.maxImagePixels } as const;
        const metadata = await sharp(original, options).metadata();
        const format =
          metadata.format === 'jpeg' ? 'jpeg' : metadata.format === 'webp' ? 'webp' : 'png';
        // 静态首帧、保留透明度、转正朝向；只缩不放，小图各档得到的都是原尺寸。
        const bytes = new Uint8Array(
          await sharp(original, options)
            .rotate()
            .resize({ width: maxEdgePx, height: maxEdgePx, fit: 'inside', withoutEnlargement: true })
            .toFormat(format)
            .toBuffer()
        );
        await variants.write(key, { format, bytes });
        return { mimeType: `image/${format}`, bytes };
      })().finally(() => encoding.delete(key));
      encoding.set(key, task);
      return task;
    },
  };
}
