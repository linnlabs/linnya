import type { Extension } from '@tiptap/core';

export { CodeBlock } from './CodeBlock';
export { CodeBlockMarkdownInputRules } from './CodeBlockMarkdownInputRules';

// 代码块内的键盘处理（依赖 KeyboardListener 提供的 keyboardRegistry）。
export const CodeBlockExtension: Extension<Record<string, never>, Record<string, never>>;
