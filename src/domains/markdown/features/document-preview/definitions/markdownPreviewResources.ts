import type {
  DocumentPreviewImageResult,
  DocumentPreviewImageSource,
  DocumentPreviewImageTier,
  MarkdownImageAttrs,
  WorkspaceMarkdownPreview,
} from '@app/schemas';

/** Host 仅提供已准入的图片事实和当前项目可见的引用身份，不把路径或其他 domain 的数据库暴露给 Markdown。 */
export interface MarkdownPreviewResources {
  /** 朝向校正后的原始像素尺寸，只读文件头；没有正式来源的空图片返回 null。预览首屏不等任何图片解码。 */
  readImageSize(input: {
    readonly documentId: string;
    readonly image: MarkdownImageAttrs;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly widthPx: number; readonly heightPx: number } | null>;
  /** 一档缩好的字节；来源不属于该文档时由 Host 拒绝。 */
  readImageVariant(input: {
    readonly documentId: string;
    readonly source: DocumentPreviewImageSource;
    readonly maxEdgePx: DocumentPreviewImageTier;
    readonly signal?: AbortSignal;
  }): Promise<DocumentPreviewImageResult>;
  readReference(input: {
    readonly sourceDocumentId: string;
    readonly targetDocumentId: string;
  }): WorkspaceMarkdownPreview['references'][string];
}
