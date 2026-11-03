import { JsonValueSchema } from '@app/schemas';
import { serializeMarkdownDocument } from '@linnya/markdown-document-core';
import type { CanvasCard, CanvasContentNode, CanvasElement, CanvasSnapshot } from '../../../../shared';
import { canvasBounds } from '../../../../shared';

export interface CanvasProjectionContext {
  readonly name: string;
  /** 只含当前项目可访问文档的当前地址；不可访问的目标不能泄漏路径或标题。 */
  readonly documentPaths: ReadonlyMap<string, string>;
  readonly documentTitles: ReadonlyMap<string, string>;
}

function projectReferenceNodes(node: CanvasContentNode, paths: ReadonlyMap<string, string>): CanvasContentNode {
  if (node.type === 'documentReference') {
    const documentId = node.attrs?.documentId;
    const path = typeof documentId === 'string' ? paths.get(documentId) : undefined;
    return path
      ? { type: 'text', text: path, marks: [{ type: 'link', attrs: { href: path } }] }
      : { type: 'text', text: '〔文档当前不可访问〕' };
  }
  return { ...node, ...(node.content ? { content: node.content.map(child => projectReferenceNodes(child, paths)) } : {}) };
}

export function projectCanvasCardBody(card: CanvasCard, context: CanvasProjectionContext): string {
  switch (card.type) {
    case 'text': return serializeMarkdownDocument(JsonValueSchema.parse(projectReferenceNodes(card.data.content, context.documentPaths)));
    case 'document': return context.documentPaths.get(card.data.documentId) ?? '〔文档当前不可访问〕';
    case 'image': return `图片：${card.data.caption || card.data.alt || '未命名图片'}`;
  }
}

export function listCanvasContentReferencedDocuments(content: CanvasContentNode): string[] {
  const ids = new Set<string>();
  const visit = (node: CanvasContentNode): void => {
    if (node.type === 'documentReference' && typeof node.attrs?.documentId === 'string') ids.add(node.attrs.documentId);
    for (const child of node.content ?? []) visit(child);
  };
  visit(content);
  return [...ids];
}
export function listCanvasReferencedDocuments(elements: readonly CanvasElement[]): string[] {
  return [...new Set(elements.flatMap(element => element.type === 'document' ? [element.data.documentId] : element.type === 'text' ? listCanvasContentReferencedDocuments(element.data.content) : []))];
}

const regions = ['左上', '上方', '右上', '左侧', '正中', '右侧', '左下', '下方', '右下'];
export function projectCanvasDocument(snapshot: CanvasSnapshot, context: CanvasProjectionContext): string {
  const cards = snapshot.elements.filter((element): element is CanvasCard => element.type !== 'edge');
  const edges = snapshot.elements.filter(element => element.type === 'edge');
  const bounds = canvasBounds(cards);
  const groups = new Map<string, CanvasCard[]>();
  for (const card of cards) {
    const column = bounds && bounds.width > 0 ? Math.min(2, Math.max(0, Math.floor((card.x + card.width / 2 - bounds.x) / bounds.width * 3))) : 1;
    const row = bounds && bounds.height > 0 ? Math.min(2, Math.max(0, Math.floor((card.y + card.height / 2 - bounds.y) / bounds.height * 3))) : 1;
    const region = regions[row * 3 + column] ?? '正中';
    const group = groups.get(region) ?? [];
    group.push(card);
    groups.set(region, group);
  }
  const lines = [
    '这是 Linnya 画布，不是 JSON Canvas。修改使用 linnya-canvas，先读取 Skill canvas。',
    `# 画布：${context.name}（${cards.length} 张卡，${edges.length} 条线）`,
    `提交序号：${snapshot.sequence}；卡片 ID 只在这张画布内有效。`,
  ];
  const summary = cards.length > 250;
  if (summary) lines.push('大画布先列各卡摘要；用 linnya-canvas show <画布路径> <卡片ID> 读取全文。');
  for (const region of regions) {
    const group = groups.get(region);
    if (!group) continue;
    lines.push(`\n## ${region}`);
    group.sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
    for (const card of group) {
      const body = projectCanvasCardBody(card, context);
      const limit = summary ? 100 : 800;
      lines.push(`- [${card.id}] ${card.type}〔${card.color}〕 revision=${card.revision}${card.locked ? '〔已锁定〕' : ''}`,
        `  ${body.slice(0, limit).replace(/\n/g, '\n  ')}${body.length > limit ? `\n  … 已截断，用 show ${card.id} 读取全文。` : ''}`);
    }
  }
  lines.push('\n## 连线');
  for (const edge of edges) {
    const from = edge.from.kind === 'card' ? edge.from.cardId : '悬空端点';
    const to = edge.to.kind === 'card' ? edge.to.cardId : '悬空端点';
    lines.push(`- [${edge.id}] ${from} ${edge.direction === 'both' ? '↔' : edge.direction === 'forward' ? '→' : '—'} ${to}${edge.label ? `「${edge.label}」` : ''}`);
  }
  return lines.join('\n');
}

/** 搜索快照不泄漏不可访问引用；上限按 UTF-8 字节计算，不能截断多字节字符。 */
export function projectCanvasSearchText(snapshot: CanvasSnapshot, context: CanvasProjectionContext): string {
  const text = snapshot.elements.map(element => `[${element.id}] ${element.type === 'edge' ? element.label : projectCanvasCardBody(element, context)}`).join('\n');
  const limit = 1_048_576;
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= limit) return text;
  const suffix = '\n〔文本快照已截断〕';
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, limit - new TextEncoder().encode(suffix).length)).replace(/\uFFFD$/, '') + suffix;
}
