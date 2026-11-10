import type { WorkspaceMarkdownPreview } from '@app/schemas';

export interface WorkspaceMarkdownPreviewInput {
  readonly content: WorkspaceMarkdownPreview;
  readonly document: Document;
  readonly widthPx: number;
  readonly theme: 'light' | 'dark';
  readonly signal: AbortSignal;
  readonly maxHeight?: number;
  readonly locale?: string;
  /** 超级标签图标由呈现宿主按文档类型提供（失效目标传 null）；portable core 不带图标资源。缺省时只显示标题。 */
  readonly referenceIcon?: (nodeType: string | null) => Node;
}
export interface WorkspaceMarkdownPreviewSurface {
  readonly element: HTMLElement;
  dispose(): void;
}
