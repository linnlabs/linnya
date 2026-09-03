import type { UiEditorInstance } from '@/shared/types';

export type ReadyMarkdownDocumentEditor = NonNullable<UiEditorInstance>;

export interface WaitForMarkdownDocumentEditorOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * 平台 Markdown 文档的富文本运行时端口。
 *
 * 该端口只服务 Tiptap/ProseMirror 文档，不属于插件通用 Document Surface 合同。
 */
export interface MarkdownDocumentEditorRuntimePort {
  getReadyEditor(): ReadyMarkdownDocumentEditor | null;
  waitForReadyEditor(
    options?: WaitForMarkdownDocumentEditorOptions,
  ): Promise<ReadyMarkdownDocumentEditor>;
}

let registeredPort: MarkdownDocumentEditorRuntimePort | null = null;

export function registerMarkdownDocumentEditorRuntimePort(
  port: MarkdownDocumentEditorRuntimePort,
): void {
  registeredPort = port;
}

export function getMarkdownDocumentEditorRuntimePort(): MarkdownDocumentEditorRuntimePort {
  if (!registeredPort) {
    throw new Error(
      '[markdownDocumentEditorRuntimePort] Markdown document editor runtime is not registered.',
    );
  }
  return registeredPort;
}
