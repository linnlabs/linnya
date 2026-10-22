import type { Extension } from '@tiptap/core';

// 输入 ``` / ```language 后转换为代码块；图表围栏语言改为开始一张示例图表。
export const CodeBlockMarkdownInputRules: Extension<Record<string, never>, Record<string, never>>;
