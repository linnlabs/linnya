import { canvasTextPrefix } from '../../../../shared';
import type { CanvasCard, CanvasEdge, CanvasSnapshot } from '../../../../shared';
import type { CanvasProjectionContext } from '../definitions/canvasProjection';
import { projectCanvasCardBody } from './projectCanvasCardBody';
import {
  canvasProjectionRegions,
  groupCanvasProjectionRegions,
} from './groupCanvasProjectionRegions';

function projectCardSummary(
  card: CanvasCard,
  context: CanvasProjectionContext,
  summary: boolean
): readonly string[] {
  const body = projectCanvasCardBody(card, context),
    limit = summary ? 100 : 800;
  return [
    `- [${card.id}] ${card.type}〔${card.color}〕 revision=${card.revision}${card.locked ? '〔已锁定〕' : ''}`,
    `  ${canvasTextPrefix(body, limit).replace(/\n/g, '\n  ')}${body.length > limit ? `\n  … 已截断，用 show ${card.id} 读取全文。` : ''}`,
  ];
}

function projectEdge(edge: CanvasEdge): string {
  const from = edge.from.kind === 'card' ? edge.from.cardId : '悬空端点';
  const to = edge.to.kind === 'card' ? edge.to.cardId : '悬空端点';
  return `- [${edge.id}] ${from} ${edge.direction === 'both' ? '↔' : edge.direction === 'forward' ? '→' : '—'} ${to}${edge.label ? `「${edge.label}」` : ''}`;
}

export function projectCanvasDocument(
  snapshot: CanvasSnapshot,
  context: CanvasProjectionContext
): string {
  const cards = snapshot.elements.filter(
    (element): element is CanvasCard => element.type !== 'edge'
  );
  const edges = snapshot.elements.filter(element => element.type === 'edge');
  const groups = groupCanvasProjectionRegions(cards);
  const lines = [
    '这是 Linnya 画布，不是 JSON Canvas。修改使用 linnya-canvas，先读取 Skill canvas。',
    `# 画布：${context.name}（${cards.length} 张卡，${edges.length} 条线）`,
    `提交序号：${snapshot.sequence}；卡片 ID 只在这张画布内有效。`,
  ];
  if (snapshot.integrity)
    lines.push(
      '〔只读：原始数据保留；部分未知或损坏元素已从显示中隔离〕',
      ...snapshot.integrity.issues.map(issue => `- ${issue.elementId ?? '画布'}：${issue.message}`)
    );
  const summary = cards.length > 250;
  if (summary)
    lines.push('大画布先列各卡摘要；用 linnya-canvas show <画布路径> <卡片ID> 读取全文。');
  for (const region of canvasProjectionRegions) {
    const group = groups.get(region);
    if (!group) continue;
    lines.push(`\n## ${region}`);
    group.sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
    for (const card of group) {
      lines.push(...projectCardSummary(card, context, summary));
    }
  }
  lines.push('\n## 连线');
  for (const edge of edges) {
    lines.push(projectEdge(edge));
  }
  return lines.join('\n');
}

/** 搜索快照不泄漏不可访问引用；上限按 UTF-8 字节计算，不能截断多字节字符。 */
export function projectCanvasSearchText(
  snapshot: CanvasSnapshot,
  context: CanvasProjectionContext
): string {
  const text = snapshot.elements
    .map(
      element =>
        `[${element.id}] ${element.type === 'edge' ? element.label : projectCanvasCardBody(element, context)}`
    )
    .join('\n');
  const limit = 1_048_576;
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= limit) return text;
  const suffix = '\n〔文本快照已截断〕';
  return (
    new TextDecoder('utf-8', { fatal: false })
      .decode(bytes.subarray(0, limit - new TextEncoder().encode(suffix).length))
      .replace(/\uFFFD$/, '') + suffix
  );
}
