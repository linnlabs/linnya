import {
  createDocumentImageAssetRuntime,
  readDocumentImageAssetLimits,
  type PluginDocumentImageAsset,
} from '@plugin/backend/documentImageAsset';
import { inspectImageBytes } from '@plugin/backend/imageInspection';
import { CanvasPrepareImageRequestSchema } from '../../shared';
import type { CanvasDatabase } from '../definitions/canvasDatabase';
import { readCanvasInputFile } from '../features/canvasCli';
import { CanvasWriteFailure } from '../features/canvasWrite';

/** 准备结果只存本次命令；dry-run解码与测量原字节，不接管、不登记。 */
export function createCanvasImagePreparation(input: {
  readonly database: CanvasDatabase;
  readonly documentId: string;
  readonly conversationRoot: string;
  readonly signal: AbortSignal;
}) {
  const runtime = createDocumentImageAssetRuntime(input.database);
  const prepared = new Map<string, string>();
  async function fromBytes(bytes: Uint8Array, dryRun: boolean): Promise<PluginDocumentImageAsset> {
    input.signal.throwIfAborted();
    let image: PluginDocumentImageAsset;
    if (dryRun) {
      const limits = readDocumentImageAssetLimits();
      if (bytes.byteLength > limits.maxImageBytes)
        throw new CanvasWriteFailure('image_unavailable', '图片超过产品图片字节预算。');
      const facts = await inspectImageBytes(bytes, { maxImagePixels: limits.maxImagePixels });
      image = {
        ...facts,
        assetId: `dry-run:${facts.sha256}`,
        dataUri: `data:${facts.mediaType};base64,${Buffer.from(bytes).toString('base64')}`,
      };
    } else image = await runtime.prepareImageBytes({ documentId: input.documentId, bytes });
    prepared.set(image.assetId, image.dataUri);
    return image;
  }
  async function prepare(source: string, dryRun: boolean): Promise<PluginDocumentImageAsset> {
    try {
      if (source.startsWith('asset:')) {
        const image = await runtime.readOwnedImage({
          documentId: input.documentId,
          assetId: source.slice(6),
        });
        prepared.set(image.assetId, image.dataUri);
        return image;
      }
      if (source.startsWith('data:')) {
        const match = /^data:image\/(?:png|jpeg|webp);base64,(.*)$/.exec(source);
        if (!match)
          throw new CanvasWriteFailure('image_unavailable', '内嵌图片须为PNG/JPEG/WebP base64。');
        const bytes = CanvasPrepareImageRequestSchema.shape.bytesBase64.parse(match[1]);
        return fromBytes(Buffer.from(bytes, 'base64'), dryRun);
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(source) && !source.startsWith('conversation:/'))
        throw new CanvasWriteFailure(
          'image_unavailable',
          'CLI不直接下载远程图片。先将图片放入conversation:/文件，再引用该文件。'
        );
      return fromBytes(
        await readCanvasInputFile(input.conversationRoot, source, input.signal),
        dryRun
      );
    } catch (error) {
      if (error instanceof CanvasWriteFailure) throw error;
      input.signal.throwIfAborted();
      throw new CanvasWriteFailure(
        'image_unavailable',
        '图片文件不可读或未通过受管图片校验；检查会话文件、格式和尺寸。'
      );
    }
  }
  return { prepare, readPreparedAssets: (): ReadonlyMap<string, string> => prepared };
}
