import type { DocumentPreviewContent, DocumentPreviewRequest, DocumentPreviewResult } from '@app/schemas';
import type { PluginSqliteDatabaseLike } from './workspaceRuntime';

export interface DocumentPreviewProviderInput {
  readonly context: unknown;
  readonly documentId: string;
  readonly widthPx: number;
  readonly pixelRatio: number;
  readonly signal?: AbortSignal;
}
/** revision 必须来自内容 owner；不能用文档标题或缓存时间冒充版本。 */
export interface DocumentPreviewCapability {
  readonly getRevision: (input: DocumentPreviewProviderInput) => string | Promise<string>;
  readonly render: (input: DocumentPreviewProviderInput) => DocumentPreviewContent | Promise<DocumentPreviewContent>;
}
/** 供 Backend 插件读取其他文档的只读预览；项目边界由 Host 校验。 */
export interface DocumentPreviewReader { read(input: DocumentPreviewRequest): Promise<DocumentPreviewResult> }
export declare function createDocumentPreviewReader(db: PluginSqliteDatabaseLike): DocumentPreviewReader;

export declare function listDocumentPreviewTypes(): readonly import('@app/schemas').DocumentPreviewType[];
