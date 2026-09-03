import type { ParsedNode } from 'stream-markdown-parser';

/**
 * 流式正文只会在尾部追加时，复用 raw 完全一致的顶层 AST 节点。
 *
 * 解析器仍可完整理解 Markdown；渲染层则能让已经封口的段落、列表和代码块保持
 * 对象 identity，使 Vue 跳过这些稳定子树，只更新仍在增长或被重新解释的尾块。
 * 非追加更新（编辑、重试替换、最终纠正）不复用，避免旧节点遮蔽真实语义变化。
 */
export function reconcileStreamingMarkdownNodes(input: {
  readonly previousMarkdown: string;
  readonly nextMarkdown: string;
  readonly previousNodes: readonly ParsedNode[];
  readonly nextNodes: readonly ParsedNode[];
}): ParsedNode[] {
  if (!input.nextMarkdown.startsWith(input.previousMarkdown)) {
    return [...input.nextNodes];
  }

  return input.nextNodes.map((node, index) => {
    const previous = input.previousNodes[index];
    if (previous?.type === node.type && previous.raw === node.raw) return previous;
    return node;
  });
}
