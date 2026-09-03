import { EditorView } from 'prosemirror-view';

interface ClosestTextLine {
  rect: DOMRect;
  verticalDistance: number;
  centerDistance: number;
}

function getVerticalDistanceToRect(rect: DOMRect, targetY: number): number {
  if (targetY < rect.top) return rect.top - targetY;
  if (targetY > rect.bottom) return targetY - rect.bottom;
  return 0;
}

function clampToRectAxis(value: number, start: number, end: number): number {
  if (end <= start) return start;
  return Math.min(Math.max(value, start), end);
}

function getPointInsideLineRect(rect: DOMRect, targetX: number, targetY: number): { x: number; y: number } {
  // 在混合行高表格里，原始 targetY 经常落在单元格的垂直空白区。
  // 这里先把点夹回最近文本行的真实矩形内部，再交给浏览器 caret API。
  const insetX = rect.width > 2 ? 1 : 0;
  const insetY = rect.height > 2 ? 1 : 0;

  return {
    x: clampToRectAxis(targetX, rect.left + insetX, rect.right - insetX),
    y: clampToRectAxis(targetY, rect.top + insetY, rect.bottom - insetY),
  };
}

function isRectUsable(rect: DOMRect): boolean {
  return rect.width > 0 || rect.height > 0;
}

function findClosestTextLine(contentBlockDom: HTMLElement, targetY: number): ClosestTextLine | null {
  const walker = contentBlockDom.ownerDocument.createTreeWalker(
    contentBlockDom,
    NodeFilter.SHOW_TEXT
  );
  let closest: ClosestTextLine | null = null;

  while (walker.nextNode()) {
    const currentNode = walker.currentNode;
    if (!currentNode.textContent) continue;

    const range = contentBlockDom.ownerDocument.createRange();
    range.selectNodeContents(currentNode);

    for (const rect of Array.from(range.getClientRects())) {
      if (!isRectUsable(rect)) continue;

      const verticalDistance = getVerticalDistanceToRect(rect, targetY);
      const centerDistance = Math.abs((rect.top + rect.bottom) / 2 - targetY);
      const shouldReplace =
        !closest ||
        verticalDistance < closest.verticalDistance ||
        (verticalDistance === closest.verticalDistance && centerDistance < closest.centerDistance);

      if (shouldReplace) {
        closest = {
          rect,
          verticalDistance,
          centerDistance,
        };
      }
    }

    range.detach();
  }

  return closest;
}

function containsDomNode(root: Node, candidate: Node | null): boolean {
  return !!candidate && (candidate === root || root.contains(candidate));
}

function resolveCaretPositionAtPoint(
  view: EditorView,
  root: HTMLElement,
  x: number,
  y: number
): number | null {
  const ownerDocument = root.ownerDocument;

  if (ownerDocument.caretPositionFromPoint) {
    const caretPosition = ownerDocument.caretPositionFromPoint(x, y);
    if (caretPosition && containsDomNode(root, caretPosition.offsetNode)) {
      return view.posAtDOM(caretPosition.offsetNode, caretPosition.offset);
    }
  }

  if (ownerDocument.caretRangeFromPoint) {
    const caretRange = ownerDocument.caretRangeFromPoint(x, y);
    if (caretRange && containsDomNode(root, caretRange.startContainer)) {
      return view.posAtDOM(caretRange.startContainer, caretRange.startOffset);
    }
  }

  return null;
}

/**
 * Finds the precise ProseMirror document position within a table cell
 * that corresponds to the given screen coordinates (x, y).
 *
 * This function is a robust replacement for `view.posAtCoords` in scenarios
 * where cells have large amounts of vertical whitespace (e.g., in mixed-height rows),
 * as it avoids the "snapping" behavior of the native method by directly
 * analyzing the geometry of rendered text lines.
 *
 * @param view - The ProseMirror EditorView instance.
 * @param cellPos - The document position of the start of the target table cell node.
 * @param targetX - The target horizontal screen coordinate.
 * @param targetY - The target vertical screen coordinate.
 * @returns The calculated document position, or `null` if no suitable position is found.
 */
export function positionInCellAtCoords(
  view: EditorView,
  cellPos: number,
  targetX: number,
  targetY: number
): number | null {
  const cellNode = view.state.doc.nodeAt(cellPos);
  if (!cellNode) return null;

  const contentBlock = cellNode.firstChild;
  if (!contentBlock) return null;
  const contentBlockPos = cellPos + 1;

  const contentBlockDom = view.nodeDOM(contentBlockPos);
  if (!(contentBlockDom instanceof HTMLElement)) return null;

  const closestLine = findClosestTextLine(contentBlockDom, targetY);
  if (!closestLine) return null;

  const adjustedPoint = getPointInsideLineRect(closestLine.rect, targetX, targetY);
  let finalPos: number | null = null;

  try {
    finalPos = resolveCaretPositionAtPoint(
      view,
      contentBlockDom,
      adjustedPoint.x,
      adjustedPoint.y
    );
  } catch (e) {
    console.warn('[positionInCellAtCoords] Error using caretPositionFromPoint:', e);
    return null;
  }
  
  // 最终仍以 ProseMirror 文档边界兜住，避免浏览器 caret API 返回单元格外部位置。
  const { content } = contentBlock;
  const contentEndPos = contentBlockPos + 1 + content.size;
  if (finalPos !== null && finalPos >= contentBlockPos + 1 && finalPos <= contentEndPos) {
    return finalPos;
  }

  return null;
}
