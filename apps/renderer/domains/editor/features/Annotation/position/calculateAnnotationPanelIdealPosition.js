import { resolveAnnotationRootBlockId } from '../functions/rootBlockIdResolver';
import { ROOT_BLOCK_DOM_CLASSES } from '../../../shared/rootBlockDomContract';

const standardizePrecision = (num) => Math.round(num * 10) / 10;
const ANNOTATION_HANDLE_RIGHT_OFFSET = 32;
const ANNOTATION_PANEL_GAP = 6;

function findRootBlockBodyElement(rootBlockOuterElement) {
  if (!rootBlockOuterElement) return null;
  if (rootBlockOuterElement.classList?.contains(ROOT_BLOCK_DOM_CLASSES.body)) {
    return rootBlockOuterElement;
  }
  const rootBlockBodyElement = rootBlockOuterElement.querySelector?.(
    `:scope > .${ROOT_BLOCK_DOM_CLASSES.body}`
  );
  return rootBlockBodyElement instanceof Element ? rootBlockBodyElement : null;
}

/**
 * 计算批注面板相对于实际 annotation-layer 的理想位置。
 *
 * 中文说明：
 * - `top/left` 最终写给 annotation-layer 的绝对定位子元素，因此必须以同一个
 *   annotation-layer 的 rect 为坐标原点，不能拿外层 wrapper 或另一个 editor 的 layer；
 * - 批注面板的横向基准来自稳定的 rootBlock 右边界；
 * - 不读取 `.annotation-handle` 的实时 rect，因为 Host 迁移后批注入口是按需
 *   Teleport surface，块移动或超大文档窗口切换时可能短暂缺失 / 处在旧坐标；
 * - x 坐标如果被这种瞬时 chrome 位置写入 store，就会出现“先跑到右侧，再
 *   下一轮布局恢复”的抖动。
 */
export function calculateAnnotationPanelIdealPosition({
  blockId,
  editor,
  panelFinder,
  includePositionStyle = false,
}) {
  if (!blockId || !panelFinder) return null;

  const rootBlockId = resolveAnnotationRootBlockId(editor, blockId) || blockId;
  const blockElement = panelFinder.findBlockElement(rootBlockId);
  if (!blockElement) return null;

  const annotationLayer = panelFinder.findAnnotationLayer();
  if (!annotationLayer) return null;

  const rootBlockBodyElement = findRootBlockBodyElement(blockElement);
  if (!rootBlockBodyElement) return null;

  const blockRect = panelFinder.getElementRect(rootBlockBodyElement);
  const annotationLayerRect = panelFinder.getElementRect(annotationLayer);
  if (!blockRect || !annotationLayerRect) return null;

  const idealTop = standardizePrecision(blockRect.top - annotationLayerRect.top);
  const idealLeft = standardizePrecision(
    blockRect.right
      - annotationLayerRect.left
      + ANNOTATION_HANDLE_RIGHT_OFFSET
      + ANNOTATION_PANEL_GAP
  );

  const result = {
    top: `${idealTop}px`,
    left: `${idealLeft}px`,
  };

  if (!includePositionStyle) return result;

  return {
    ...result,
    position: 'absolute',
  };
}
