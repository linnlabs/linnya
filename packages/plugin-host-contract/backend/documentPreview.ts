import type {
  DocumentPreviewContent,
  DocumentPreviewImageRequest,
  DocumentPreviewImageResult,
  DocumentPreviewImageSource,
  DocumentPreviewImageTier,
  DocumentPreviewRequest,
  DocumentPreviewResult,
} from '@app/schemas';
import type { PluginSqliteDatabaseLike } from './workspaceRuntime';

export interface DocumentPreviewProviderInput {
  readonly context: unknown;
  readonly documentId: string;
  /**
   * 封面的出图尺寸。Host 已把调用方请求的宽度和像素比归到固定档位（宽度 320/640/1280/1600，像素比 1 或 2），
   * 消费方按容器宽度缩放显示；不要把它当成某张卡片的实际宽度。声明 sizeIndependent 的类型收到的是原始请求值。
   */
  readonly widthPx: number;
  readonly pixelRatio: number;
  readonly signal?: AbortSignal;
}
export interface DocumentPreviewImageProviderInput {
  readonly context: unknown;
  readonly documentId: string;
  readonly source: DocumentPreviewImageSource;
  readonly maxEdgePx: DocumentPreviewImageTier;
  readonly signal?: AbortSignal;
}
/** revision 必须来自内容 owner；不能用文档标题或缓存时间冒充版本。 */
export interface DocumentPreviewCapability {
  readonly getRevision: (input: DocumentPreviewProviderInput) => string | Promise<string>;
  readonly render: (input: DocumentPreviewProviderInput) => DocumentPreviewContent | Promise<DocumentPreviewContent>;
  /** 内容与请求的宽度、像素比无关时声明：Host 按版本只缓存一份，各入口共用。未声明时按归档后的宽度与像素比分别缓存。 */
  readonly sizeIndependent?: boolean;
  /** 预览里只列清单的图片由此按档取字节；来源必须属于该文档，否则返回 null。不列图片清单的类型不必实现。 */
  readonly readImage?: (
    input: DocumentPreviewImageProviderInput
  ) => DocumentPreviewImageResult | Promise<DocumentPreviewImageResult>;
}
/** 供 Backend 插件读取其他文档的只读预览；项目边界由 Host 校验。 */
export interface DocumentPreviewReader {
  read(input: DocumentPreviewRequest): Promise<DocumentPreviewResult>;
  readImage(input: DocumentPreviewImageRequest): Promise<DocumentPreviewImageResult>;
}
export declare function createDocumentPreviewReader(db: PluginSqliteDatabaseLike): DocumentPreviewReader;

export declare function listDocumentPreviewTypes(): readonly import('@app/schemas').DocumentPreviewType[];
