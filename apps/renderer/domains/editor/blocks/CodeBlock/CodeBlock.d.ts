import type { Node } from '@tiptap/core';

// 保留 JS 实现的公开扩展合同：基于 CodeBlockLowlight，需要显式传入 lowlight 实例。
export interface CodeBlockOptions {
  lowlight: unknown;
  HTMLAttributes: Record<string, unknown>;
  allowLanguageSelection: boolean;
  [option: string]: unknown;
}

export const CodeBlock: Node<CodeBlockOptions, unknown>;
export default CodeBlock;
