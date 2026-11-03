import type { JsonValue } from '@app/schemas';

/** 独立正文，不持有 Workspace 文档身份、保存状态或外层选择。 */
export interface EmbeddedMarkdownEditorOptions {
  readonly element: HTMLElement;
  readonly content: JsonValue;
  readonly label: string;
  readonly readonly?: boolean;
  readonly onUpdate: (content: JsonValue) => void;
  readonly onBlur?: () => void;
  /** 临时显示源由调用方解析；结构化正文仍保留原始稳定src。 */
  readonly resolveImageSource?: (source: string) => Promise<string>;
  readonly onError?: (message: string) => void;
}

export interface EmbeddedMarkdownInsertion {
  /** 锚点跟随后续编辑；正文被替换或表面销毁后返回false，不插入其他文档。 */
  insert(content: JsonValue): boolean;
  cancel(): void;
}

export interface EmbeddedMarkdownEditor {
  readContent(): JsonValue;
  readMarkdown(): string;
  /** 严格校验后原子替换；失败保留旧正文，不触发 onUpdate。 */
  replaceContent(content: JsonValue): void;
  insertContent(content: JsonValue): void;
  captureInsertion(): EmbeddedMarkdownInsertion;
  setEditable(editable: boolean): void;
  focus(): void;
  destroy(): void;
}

export declare function createEmbeddedMarkdownEditor(
  options: EmbeddedMarkdownEditorOptions,
): EmbeddedMarkdownEditor;

export declare function parseEmbeddedMarkdown(markdown: string): JsonValue;
export declare function serializeEmbeddedMarkdown(content: JsonValue): string;
