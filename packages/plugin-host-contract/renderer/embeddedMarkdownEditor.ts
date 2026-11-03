import type { JsonValue } from '@app/schemas';

/** 独立正文，不持有 Workspace 文档身份、保存状态或外层选择。 */
export interface EmbeddedMarkdownEditorOptions {
  readonly element: HTMLElement;
  readonly content: JsonValue;
  readonly label: string;
  readonly readonly?: boolean;
  readonly onUpdate: (content: JsonValue) => void;
  readonly onBlur?: () => void;
}

export interface EmbeddedMarkdownEditor {
  readContent(): JsonValue;
  readMarkdown(): string;
  /** 严格校验后原子替换；失败保留旧正文，不触发 onUpdate。 */
  replaceContent(content: JsonValue): void;
  setEditable(editable: boolean): void;
  focus(): void;
  destroy(): void;
}

export declare function createEmbeddedMarkdownEditor(
  options: EmbeddedMarkdownEditorOptions,
): EmbeddedMarkdownEditor;

export declare function parseEmbeddedMarkdown(markdown: string): JsonValue;
export declare function serializeEmbeddedMarkdown(content: JsonValue): string;
