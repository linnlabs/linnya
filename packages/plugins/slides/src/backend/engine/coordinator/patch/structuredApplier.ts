/**
 * Structured slide patch 子链
 *
 * 单一职责：把 element-level patch operation 应用到 `StructuredSlideSpec`
 * 的某个具体元素上。
 *
 * 流程：
 * 1. 用 `findStructuredElementIndex` 在 spec.elements 里挑分最高的候选
 *    （类型一致 + 几何接近 + 文本匹配）；找不到时静默 no-op，不抛错。
 * 2. 按 `operation.op` 分发到对应的 update handler。
 *
 * 设计要点：
 * - 整段都是**对 `slideSpec.elements[index]` 的 immutable 替换**——避免在
 *   同一个对象上意外共享引用；外层在 `apply()` 已经先深拷贝过 deck，
 *   这里只动顶层引用。
 * - 类型映射 `elementCategory` 与 freeform 那边的 `freeformElementCategory`
 *   一一对应：shape+text → 'text'，否则按 element.type；保证打分阶段两条
 *   主链对"同一个元素"的归类一致。
 */

import type {
  Box,
  SlideElementInfo,
  StructuredElement,
  StructuredSlideSpec,
  TextStyle,
} from '@plugin/slides/shared';
import { mergeBox, positionScore, reorderItem } from './shared.js';
import type { ElementPatchOperation } from './types.js';

export function applyStructuredElementOp(
  slideSpec: StructuredSlideSpec,
  operation: ElementPatchOperation,
  sourceElement: SlideElementInfo,
): void {
  const elementIndex = findStructuredElementIndex(slideSpec, sourceElement);
  if (elementIndex < 0) {
    return;
  }

  const current = slideSpec.elements[elementIndex];
  switch (operation.op) {
    case 'modify_text':
      slideSpec.elements[elementIndex] = updateStructuredText(
        current,
        operation.text,
        operation.textStyle,
      );
      break;
    case 'replace_image':
      if (current.type === 'image') {
        slideSpec.elements[elementIndex] = { ...current, src: operation.newImage };
      }
      break;
    case 'update_chart':
      if (current.type === 'chart') {
        slideSpec.elements[elementIndex] = { ...current, data: operation.data };
      }
      break;
    case 'update_table':
      if (current.type === 'table') {
        slideSpec.elements[elementIndex] = { ...current, rows: operation.rows };
      }
      break;
    case 'modify_style':
      if (current.type === 'shape') {
        slideSpec.elements[elementIndex] = {
          ...current,
          style: {
            ...current.style,
            ...operation.style,
          },
        };
      }
      break;
    case 'modify_geometry':
      slideSpec.elements[elementIndex] = {
        ...current,
        position: mergeBox(current.position, operation.position),
      };
      break;
    case 'reorder_layer':
      reorderItem(slideSpec.elements, elementIndex, operation.placement);
      break;
  }
}

function findStructuredElementIndex(
  slideSpec: StructuredSlideSpec,
  sourceElement: SlideElementInfo,
): number {
  let bestIndex = -1;
  let bestScore = Number.NEGATIVE_INFINITY;

  slideSpec.elements.forEach((element, index) => {
    const score = scoreElementMatch(element, sourceElement);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestScore > 0 ? bestIndex : -1;
}

function scoreElementMatch(
  element: StructuredElement,
  sourceElement: SlideElementInfo,
): number {
  if (elementCategory(element) !== sourceElement.type) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 10;
  if (sourceElement.position) {
    score += positionScore(element.position, sourceElement.position);
  }

  const elementText = structuredElementText(element);
  if (sourceElement.text && elementText) {
    score += sourceElement.text === elementText ? 30 : -10;
  }

  return score;
}

function elementCategory(element: StructuredElement): SlideElementInfo['type'] {
  switch (element.type) {
    case 'title':
    case 'text':
    case 'bulletList':
    case 'numberedList':
      return 'text';
    case 'shape':
      return element.text ? 'text' : 'shape';
    case 'image':
    case 'svgGraphic':
    case 'chart':
    case 'table':
      return element.type;
    case 'formula':
      return 'other';
  }
}

function structuredElementText(element: StructuredElement): string | undefined {
  switch (element.type) {
    case 'title':
      return element.content;
    case 'text':
      return typeof element.content === 'string'
        ? element.content
        : element.content.map((run) => 'text' in run ? run.text : '').join('');
    case 'bulletList':
    case 'numberedList':
      return element.items.map((item) => item.text).join('\n');
    case 'shape':
      return element.text;
    case 'image':
    case 'svgGraphic':
    case 'formula':
    case 'chart':
    case 'table':
      return undefined;
  }
}

function updateStructuredText(
  element: StructuredElement,
  text?: string,
  textStyle?: Partial<TextStyle>,
): StructuredElement {
  switch (element.type) {
    case 'title':
    case 'text': {
      const updated = { ...element };
      if (text != null) updated.content = text;
      if (textStyle) updated.style = { ...updated.style, ...textStyle };
      return updated;
    }
    case 'bulletList':
    case 'numberedList': {
      if (text != null) {
        return {
          type: 'text',
          content: text,
          style: textStyle ? { ...element.style, ...textStyle } : element.style,
          position: element.position,
        };
      }
      if (textStyle) {
        return { ...element, style: { ...element.style, ...textStyle } };
      }
      return element;
    }
    case 'shape':
      if (text != null) return { ...element, text };
      return element;
    case 'image':
    case 'svgGraphic':
    case 'formula':
    case 'chart':
    case 'table':
      return element;
  }
}

// position 类型由 mergeBox 处理；这里仅暴露内部用到的 Box 类型给 TS 编译器。
export type { Box };
