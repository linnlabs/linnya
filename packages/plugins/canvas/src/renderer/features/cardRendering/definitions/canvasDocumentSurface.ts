import type { Component } from 'vue';
import type { DocumentPreviewResult } from '@app/schemas';
import type { CanvasDocumentPreviewBody } from '../../../../shared/rendering';

export interface CanvasDocumentSurfacePresentation {
  readonly title: string | null;
  readonly status?: DocumentPreviewResult['status'];
  readonly summary?: string;
  readonly image?: string;
  /** 文档正文开头（Markdown 或纯文本），有它时卡片排正文而不是摘要。 */
  readonly body?: CanvasDocumentPreviewBody;
  /** 文档类型在文件树里的图标；后台出图拿不到时用通用文件图标。 */
  readonly icon?: Component;
  /** 内容方声明缩略图更能代表文档（如演示文稿第一页）；否则有正文时排正文，不用封面图。 */
  readonly thumbnail?: boolean;
}
