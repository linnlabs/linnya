/**
 * Freeform slide patch 子链
 *
 * 单一职责：把 element-level patch operation 应用到 `FreeformSlideSpec` 的
 * 嵌套元素树上。
 *
 * 与 structured 链的核心差异：
 * - **嵌套**：freeform 支持 `group` 嵌套，必须递归遍历；
 * - **透视变换**：group 通过 `position` + 子节点实际 bounds 隐式做缩放/平移，
 *   匹配元素时要把局部坐标"反算"成 slide 全局；写回 geometry 时再把 patch
 *   传入的全局坐标"再反算"回该元素的局部坐标。
 *
 * 流程：
 * 1. `visitFreeformElements` 递归累积 transform，叶子元素 → callback；
 * 2. callback 用 `scoreFreeformElementMatch` 打分（类型 + 几何 + 文本）；
 * 3. 主类拿 best match 后按 op 分发到对应 update。
 *
 * 设计要点：
 * - 所有"局部 ↔ 全局"换算都收敛在 `backend/engine/shared/freeformTransform.ts`：
 *   `applyFreeformTransform` / `toLocalFreeformBox` /
 *   `buildFreeformGroupTransform`。生成态文本测量也复用同一变换合同，禁止
 *   任何路径在外部手动计算 transform。
 */

import type {
  Box,
  FreeformElement,
  FreeformSlideSpec,
  SlideElementInfo,
} from '@plugin/slides/shared';
import {
  applyFreeformTransform,
  buildFreeformGroupTransform,
  IDENTITY_FREEFORM_TRANSFORM,
  toLocalFreeformBox,
  type FreeformTransform,
} from '../../shared/freeformTransform.js';
import { positionScore, reorderItem } from './shared.js';
import type { ElementPatchOperation, FreeformElementMatch } from './types.js';

export function applyFreeformElementOp(
  slideSpec: FreeformSlideSpec,
  operation: ElementPatchOperation,
  sourceElement: SlideElementInfo,
): void {
  const freeformMatch = findFreeformElementMatch(slideSpec, sourceElement);
  if (!freeformMatch) {
    return;
  }

  switch (operation.op) {
    case 'modify_text':
      if (freeformMatch.element.type === 'text' || freeformMatch.element.type === 'shape') {
        if (operation.text != null) freeformMatch.element.content = operation.text;
        if (operation.textStyle) {
          freeformMatch.element.style = { ...freeformMatch.element.style, ...operation.textStyle };
        }
      }
      break;
    case 'replace_image':
      if (freeformMatch.element.type === 'image') {
        freeformMatch.element.src = operation.newImage;
      }
      break;
    case 'modify_style':
      if (freeformMatch.element.type === 'shape') {
        freeformMatch.element.style = {
          ...freeformMatch.element.style,
          ...operation.style,
        };
      }
      break;
    case 'modify_geometry':
      freeformMatch.element.position = toLocalFreeformBox(
        freeformMatch.element.position,
        operation.position,
        freeformMatch.transform,
      );
      break;
    case 'reorder_layer':
      reorderItem(freeformMatch.parent, freeformMatch.index, operation.placement);
      break;
    case 'update_chart':
    case 'update_table':
      // freeform spec 暂未承载 chart/table 子节点；后续接通时在此扩展。
      break;
  }
}

function findFreeformElementMatch(
  slideSpec: FreeformSlideSpec,
  sourceElement: SlideElementInfo,
): FreeformElementMatch | null {
  let bestMatch: FreeformElementMatch | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  visitFreeformElements(
    slideSpec.elements,
    IDENTITY_FREEFORM_TRANSFORM,
    (element, actualPosition, parent, index, transform) => {
      const score = scoreFreeformElementMatch(element, actualPosition, sourceElement);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { element, actualPosition, parent, index, transform };
      }
    },
  );

  return bestScore > 0 ? bestMatch : null;
}

function visitFreeformElements(
  elements: FreeformElement[],
  transform: FreeformTransform,
  visit: (
    element: FreeformElement,
    actualPosition: Box,
    parent: FreeformElement[],
    index: number,
    transform: FreeformTransform,
  ) => void,
): void {
  elements.forEach((element, index) => {
    if (element.type === 'group') {
      if (!element.children?.length) {
        return;
      }

      const groupTransform = buildFreeformGroupTransform(element, transform);
      visitFreeformElements(element.children, groupTransform, visit);
      return;
    }

    visit(
      element,
      applyFreeformTransform(element.position, transform),
      elements,
      index,
      transform,
    );
  });
}

function scoreFreeformElementMatch(
  element: FreeformElement,
  actualPosition: Box,
  sourceElement: SlideElementInfo,
): number {
  if (freeformElementCategory(element) !== sourceElement.type) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 10;
  if (sourceElement.position) {
    score += positionScore(actualPosition, sourceElement.position);
  }

  const elementText = freeformElementText(element);
  if (sourceElement.text && elementText) {
    score += sourceElement.text === elementText ? 30 : -10;
  }

  return score;
}

function freeformElementCategory(element: FreeformElement): SlideElementInfo['type'] {
  switch (element.type) {
    case 'text':
      return 'text';
    case 'image':
      return 'image';
    case 'svgGraphic':
      return 'svgGraphic';
    case 'formula':
      return 'other';
    case 'shape':
      return element.content ? 'text' : 'shape';
    case 'group':
      return 'group';
  }
}

function freeformElementText(element: FreeformElement): string | undefined {
  if (
    element.type === 'image'
    || element.type === 'svgGraphic'
    || element.type === 'formula'
    || element.type === 'group'
  ) {
    return undefined;
  }
  if (typeof element.content === 'string') {
    return element.content;
  }
  if (!Array.isArray(element.content)) {
    return undefined;
  }
  return element.content.map((run) => 'text' in run ? run.text : '').join('');
}
