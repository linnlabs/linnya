import {
  canvasTextPrefix,
  orderCanvasCardsForReading,
  readCanvasCardConnections,
  readCanvasCardTags,
  readCanvasSectionMembers,
} from '../../../../shared';
import type { CanvasCard, CanvasEdge, CanvasSnapshot } from '../../../../shared';
import type { CanvasProjectionContext } from '../definitions/canvasProjection';
import { projectCanvasCardBody } from './projectCanvasCardBody';
import { describeCanvasEdge, describeCanvasModification } from './projectCanvasModification';
import {
  canvasProjectionRegions,
  groupCanvasProjectionRegions,
} from './groupCanvasProjectionRegions';

/** 状态与标签按当前工作区名称列出，没有时不占位。 */
export function describeCanvasCardTags(card: CanvasCard, context: CanvasProjectionContext): string {
  const { status, tags } = readCanvasCardTags(card, context.tags);
  return `${status ? ` 状态：${status.name}` : ''}${
    tags.length ? ` 标签：${tags.map(tag => `#${tag.name}`).join(' ')}` : ''
  }`;
}

function projectCardSummary(
  card: CanvasCard,
  context: CanvasProjectionContext,
  summary: boolean,
  indent = ''
): readonly string[] {
  const body = projectCanvasCardBody(card, context),
    limit = summary ? 100 : 800,
    inner = `${indent}  `;
  return [
    `${indent}- [${card.id}] ${card.type}〔${card.color}〕 revision=${card.revision}${card.locked ? '〔已锁定〕' : ''}${describeCanvasCardTags(card, context)} ${describeCanvasModification(card)}`,
    `${inner}${canvasTextPrefix(body, limit).replace(/\n/g, `\n${inner}`)}${body.length > limit ? `\n${inner}… 已截断，用 show ${card.id} 读取全文。` : ''}`,
  ];
}

function projectEdge(edge: CanvasEdge): string {
  return `- [${edge.id}] ${describeCanvasEdge(edge)} ${describeCanvasModification(edge)}`;
}

export function projectCanvasDocument(
  snapshot: CanvasSnapshot,
  context: CanvasProjectionContext
): string {
  const cards = snapshot.elements.filter(
    (element): element is CanvasCard => element.type !== 'edge'
  );
  const edges = snapshot.elements.filter(element => element.type === 'edge');
  // 方位按区外的卡与分区本身划分；成员紧跟所属分区缩进列出。
  const sections = readCanvasSectionMembers(snapshot.elements),
    members = new Set([...sections.values()].flat().map(card => card.id));
  const groups = groupCanvasProjectionRegions(cards.filter(card => !members.has(card.id))),
    connections = readCanvasCardConnections(snapshot.elements);
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
    const inRegion = group.flatMap(card => [card, ...(sections.get(card.id) ?? [])]);
    for (const card of orderCanvasCardsForReading(inRegion, connections)) {
      lines.push(...projectCardSummary(card, context, summary, members.has(card.id) ? '  ' : ''));
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
