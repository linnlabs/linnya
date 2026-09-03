import type { SlideElementInfo } from '@plugin/slides/shared';
import type { DiagnosticNodeRef } from '../definitions';

const MAX_LABEL_LENGTH = 40;

/** 把 lint input 收敛为 finding 需要的窄节点事实，不复制样式或全文。 */
export function buildDiagnosticNodeRef(
  element: SlideElementInfo,
): DiagnosticNodeRef {
  if (!element.position) {
    throw new Error(`Diagnostic node ${element.name} has no final position`);
  }
  return {
    nodeId: element.nodeId ?? element.elementId ?? element.name,
    kind: element.type,
    label: buildNodeLabel(element),
    finalBox: { ...element.position, unit: 'in' },
    zIndex: element.zIndex ?? 0,
    ...(element.parentNodeId ? { parentNodeId: element.parentNodeId } : {}),
  };
}

function buildNodeLabel(element: SlideElementInfo): string {
  const normalizedText = element.text?.replace(/\s+/g, ' ').trim();
  const value = normalizedText || element.name.trim() || element.type;
  return value.length <= MAX_LABEL_LENGTH
    ? value
    : `${value.slice(0, MAX_LABEL_LENGTH - 1)}…`;
}
