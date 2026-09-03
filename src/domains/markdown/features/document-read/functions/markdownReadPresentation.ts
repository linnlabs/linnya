/**
 * @file markdownReadPresentation.ts
 * @description 从当前 DocumentView 窗口构建严格的 UI presentation
 *
 * 仅用于 UI 展示，不用于 AI 编辑定位。
 * UI 序号是"当前窗口内"的连续序号（1,2,3...），不是全局序号。
 */

import type { WorkspaceDocumentReadPresentation } from '@app/schemas';
import type { FlattenedMarkdownBlock } from '../../../shared/markdownBlockProjection';

/**
 * 把 Agent 使用的 DocumentView 窗口投影成 UI presentation。
 *
 * 中文说明：稳定身份来自原始 blockId，绝不使用窗口序号充当 key。若字符窗口从块中间
 * 开始，当前片段已经失去完整块边界，此时明确投影为 text，而不是猜测一个块身份。
 */
export function buildMarkdownReadPresentation(params: {
  readonly documentViewText: string;
  readonly blocks: readonly FlattenedMarkdownBlock[];
  readonly viewMode: 'preview' | 'base';
  readonly viewLabel: string;
}): WorkspaceDocumentReadPresentation {
  const { documentViewText, blocks, viewMode, viewLabel } = params;
  const separator = '\n---\n';
  const sepIndex = documentViewText.indexOf(separator);
  if (sepIndex === -1) {
    throw new Error('Workspace DocumentView is missing the canonical header separator');
  }

  const afterHeader = documentViewText.slice(sepIndex + separator.length);
  const endTagIndex = afterHeader.indexOf('</workspace_document>');
  if (endTagIndex === -1) {
    throw new Error('Workspace DocumentView is missing the canonical closing tag');
  }
  const body = afterHeader.slice(0, endTagIndex).trim();
  if (!body) return { kind: 'blocks', viewMode, viewLabel, items: [] };

  const lines = body.split(/\r?\n/);
  const firstContentLine = lines.find((line) => line.trim().length > 0);
  if (!firstContentLine?.match(/^\[(#[^\]]+)\]\s*/)) {
    return { kind: 'text', text: body };
  }

  const blocksByRef = new Map(blocks.map((block) => [block.ref, block]));
  const items: Array<{ id: string; ordinal: number; text: string }> = [];
  let current: { block: FlattenedMarkdownBlock; lines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    // Phase 7 insert 会先创建"空块实体"（content_json 中存在 rootBlock，但文本来自 pending）。
    // 在 base 视图下这些块可能是空字符串，保留空块交由 UI 决定如何展示。
    const text = current.lines.join('\n').trimEnd();
    items.push({ id: current.block.blockId, ordinal: current.block.index, text });
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) {
      if (current) current.lines.push('');
      continue;
    }

    const m = line.match(/^\[(#[^\]]+)\]\s*(.*)$/);
    if (m) {
      flush();
      const ref = m[1];
      const block = blocksByRef.get(ref);
      if (!block) {
        throw new Error(`Workspace DocumentView references an unknown block: ${ref}`);
      }
      current = { block, lines: [] };
      const first = (m[2] ?? '').trimEnd();
      if (first) current.lines.push(first);
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  flush();
  return { kind: 'blocks', viewMode, viewLabel, items };
}
