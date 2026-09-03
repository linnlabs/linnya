/**
 * @file markdownOutline.ts
 * @description Markdown 文档结构视图使用的大纲构建器（纯函数）
 *
 * 仅用于 include_structure_only 模式：
 * - 从 Markdown 文档的 content_json（ProseMirror JSON）中提取标题结构
 * - 输出人类可读的缩进大纲文本
 *
 * 注意：此模块只做“读取视图”的转换，不触达 DB，也不依赖 ToolContext。
 */

/**
 * 从 ProseMirror JSON 中提取纯文本（尽量兼容不同节点形态）。
 *
 * - 会读取 node.text
 * - 会读取 node.attrs.title / node.attrs.topic
 * - 会递归遍历 node.content / node.children
 */
function extractPlainText(content: unknown): { text: string; totalLength: number } {
  const chunks: string[] = [];

  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as {
      text?: unknown;
      attrs?: Record<string, unknown>;
      content?: unknown;
      children?: unknown;
    };

    if (typeof n.text === 'string') {
      chunks.push(n.text);
    }

    if (n.attrs) {
      const maybeTitle = (n.attrs as Record<string, unknown>).title || (n.attrs as Record<string, unknown>).topic;
      if (typeof maybeTitle === 'string') {
        chunks.push(maybeTitle);
      }
    }

    if (Array.isArray(n.content)) {
      n.content.forEach(walk);
    }

    if (Array.isArray(n.children)) {
      n.children.forEach(walk);
    }
  };

  walk(content);
  const text = chunks.join(' ').replace(/\s+/g, ' ').trim();
  return { text, totalLength: text.length };
}

/**
 * 构建文档大纲结构。
 *
 * 识别 Markdown 文档中的标题节点：
 * - baseBlock 类型且 blockType === 'heading'（我们的 Tiptap 结构）
 * - 或者直接是 heading/h1/h2...（兼容其他格式）
 */
export function buildMarkdownOutline(content: unknown): string {
  const lines: string[] = [];

  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const n = node as {
      type?: unknown;
      attrs?: Record<string, unknown>;
      content?: unknown;
    };

    const nodeType = typeof n.type === 'string' ? n.type : '';
    const isBaseBlockHeading =
      nodeType === 'baseBlock' &&
      (n.attrs?.blockType === 'heading');

    const isDirectHeading =
      nodeType === 'heading' ||
      nodeType === 'headingBlock' ||
      nodeType === 'title' ||
      nodeType === 'h1' ||
      nodeType === 'h2' ||
      nodeType === 'h3' ||
      nodeType === 'h4' ||
      nodeType === 'h5' ||
      nodeType === 'h6';

    const isHeading = isBaseBlockHeading || isDirectHeading;

    if (isHeading) {
      const { text } = extractPlainText(n);
      if (text) {
        const levelFromAttrs = n.attrs?.level;
        const levelFromTypeMatch = nodeType.match(/h(\d)/)?.[1];
        const level =
          typeof levelFromAttrs === 'number'
            ? levelFromAttrs
            : (levelFromTypeMatch ? Number.parseInt(levelFromTypeMatch, 10) : 1);
        const safeLevel = Math.max(1, Math.min(6, Number.isFinite(level) ? level : 1));

        const indent = '  '.repeat(safeLevel - 1);
        const prefix = '#'.repeat(safeLevel);
        lines.push(`${indent}${prefix} ${text}`);
      }
    }

    if (Array.isArray(n.content)) {
      n.content.forEach(visit);
    }
  };

  visit(content);

  if (lines.length === 0) {
    return '（此文档没有标题结构）';
  }

  return lines.join('\n');
}
