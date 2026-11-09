import type { WorkspaceMarkdownPreview } from '@app/schemas';

export interface WorkspaceMarkdownPreviewInput {
  readonly content: WorkspaceMarkdownPreview;
  readonly document: Document;
  readonly widthPx: number;
  readonly theme: 'light' | 'dark';
  readonly signal: AbortSignal;
  readonly maxHeight?: number;
  readonly locale?: string;
}
export interface WorkspaceMarkdownPreviewSurface {
  readonly element: HTMLElement;
  dispose(): void;
}
