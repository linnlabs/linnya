import type { MarkdownImageAttrs, WorkspaceMarkdownPreview } from '@app/schemas';

/** Host 仅提供已准入的图片字节和当前项目可见的引用身份，不把路径或其他 domain 的数据库暴露给 Markdown。 */
export interface MarkdownPreviewResources {
  readImage(input: {
    readonly documentId: string;
    readonly image: MarkdownImageAttrs;
    readonly signal?: AbortSignal;
  }): Promise<string | null>;
  readReference(input: {
    readonly sourceDocumentId: string;
    readonly targetDocumentId: string;
  }): WorkspaceMarkdownPreview['references'][string];
}
