import { createDocumentImageAssetRuntime } from '@plugin/backend/documentImageAsset';
import { CanvasImportImageRequestSchema, type CanvasReadImageRequest } from '../../shared';
import type { CanvasDatabase } from '../definitions/canvasDatabase';
import type { CanvasDocumentRuntime } from './createCanvasDocumentRuntime';

export function createCanvasImageRuntime(database: CanvasDatabase, document: CanvasDocumentRuntime) {
  const assets = createDocumentImageAssetRuntime(database);
  return {
    async importImage(value: unknown) {
      const input = CanvasImportImageRequestSchema.parse(value);
      document.read(input.documentId);
      const image = await assets.prepareImageBytes({ documentId: input.documentId, bytes: Buffer.from(input.bytesBase64, 'base64') });
      const width = Math.min(480, image.width);
      // 字节先准入；归属由共同提交事务登记，失败时不会留下半张卡或错误归属。
      return document.commit({ documentId: input.documentId, viewId: input.viewId, requestId: input.requestId,
        operations: [{ op: 'addImage', width, height: width * image.height / image.width, x: input.x, y: input.y,
          data: { assetId: image.assetId, caption: input.caption, alt: input.alt, crop: null } }],
      });
    },
    async readImage(input: CanvasReadImageRequest) {
      document.read(input.documentId);
      return assets.readOwnedImage(input);
    },
  };
}
