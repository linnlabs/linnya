import path from 'node:path';
import { parseFileLocator, MarkdownImageInvalidError } from '@app/schemas';
import type { ToolContext } from 'src/tools/types';
import type { ResolveMarkdownImageSource } from 'src/domains/markdown';
import { encodeMediaLocatorPath } from 'src/features/system/media/functions/docImageLocator';

export type MarkdownImageSourceContext = Pick<
  ToolContext,
  | 'conversationId'
  | 'conversationWorkDirectoryAdmission'
  | 'physicalFileReader'
  | 'managedImageIngress'
>;

/** 目录准入与读取均留在 Host；Markdown 只取得已经接管的资产事实。 */
export function createMarkdownImageSourceResolver(
  context: MarkdownImageSourceContext
): ResolveMarkdownImageSource {
  return async locator => {
    const parsed = parseFileLocator(locator);
    if (parsed.kind !== 'conversation')
      throw new MarkdownImageInvalidError('新图片必须来自 conversation:/ 文件。');
    const {
      conversationId,
      conversationWorkDirectoryAdmission: admission,
      physicalFileReader: reader,
      managedImageIngress: ingress,
    } = context;
    if (!conversationId || !admission || !reader || !ingress) {
      throw new MarkdownImageInvalidError('当前调用缺少会话图片准入能力。');
    }
    return admission.withAdmission({ conversationId }, async directory => {
      const physical = await reader.readFile({
        absolutePath: path.resolve(directory.absolutePath, ...parsed.relativePath.split('/')),
        scope: { kind: 'conversation', rootPath: directory.absolutePath },
      });
      if (physical.kind !== 'image_source')
        throw new MarkdownImageInvalidError('仅支持 PNG、JPEG、WebP 图片。');
      const asset = await ingress.ingestLocalImage({ sourcePath: physical.resolvedPath });
      return {
        assetId: asset.assetId,
        width: asset.width,
        height: asset.height,
        src: `media://load/asset-image/${encodeMediaLocatorPath(asset.assetId)}`,
      };
    });
  };
}
