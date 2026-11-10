import type { Component } from 'vue';
import type { DocumentPreviewResult, DocumentPreviewDetail } from '@app/schemas';
import type { CanvasColor } from '../../../../shared';

export interface CanvasDocumentSurfacePresentation {
  readonly title: string | null;
  readonly status?: DocumentPreviewResult['status'];
  readonly summary?: string;
  readonly image?: string;
  /** 内容 owner 的用户预览载荷；Canvas 不解释正文格式。 */
  readonly body?: DocumentPreviewDetail;
  /** 文档类型在文件树里的图标；后台出图拿不到时用通用文件图标。 */
  readonly icon?: Component;
  /** 正文里超级标签的类型图标；后台出图不传，标签用通用文件图标。 */
  readonly referenceTypeIcon?: (nodeType: string) => Component | null;
  /** 内容方声明缩略图更能代表文档（如演示文稿第一页）；否则有正文时排正文，不用封面图。 */
  readonly thumbnail?: boolean;
}

export interface CanvasDocumentSurfaceContext {
  readonly document: Document;
  readonly card: {
    readonly documentId: string;
    readonly width: number;
    readonly height: number;
    readonly color: CanvasColor;
  };
  readonly signal: AbortSignal;
  readonly theme: 'light' | 'dark';
}
