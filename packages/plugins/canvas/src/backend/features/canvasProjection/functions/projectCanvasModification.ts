import type { CanvasEdge, CanvasElement } from '../../../../shared';

const pad = (value: number) => String(value).padStart(2, '0');

/** 本机时区的“年-月-日 时:分:秒”；`changes --since` 按同一格式解析，Agent 可原样回填。 */
export function formatCanvasTime(milliseconds: number): string {
  const date = new Date(milliseconds);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 元素最后一次修改的来源与时间；只区分用户与 Agent，不输出对话或运行身份。 */
export function projectCanvasModification(element: CanvasElement) {
  return {
    updatedBy: element.updatedBy.kind,
    updatedAt: formatCanvasTime(element.updatedAt),
  } as const;
}

export function describeCanvasModification(element: CanvasElement): string {
  return `最后修改：${element.updatedBy.kind === 'user' ? '用户' : 'Agent'} ${formatCanvasTime(element.updatedAt)}`;
}

export function describeCanvasEdge(edge: CanvasEdge): string {
  const from = edge.from.kind === 'card' ? edge.from.cardId : '悬空端点';
  const to = edge.to.kind === 'card' ? edge.to.cardId : '悬空端点';
  return `${from} ${edge.direction === 'both' ? '↔' : edge.direction === 'forward' ? '→' : '—'} ${to}${edge.label ? `「${edge.label}」` : ''}`;
}
