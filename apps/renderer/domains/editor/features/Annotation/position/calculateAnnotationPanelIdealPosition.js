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
 * 计算批注面板相对于 scroll-content-wrapper 的理想位置。
 *
 * 中文说明：
 * - 批注面板的横向基准应该来自稳定的 rootBlock 右边界；
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

  const wrapper = panelFinder.findScrollContentWrapper();
  if (!wrapper) return null;

  const rootBlockBodyElement = findRootBlockBodyElement(blockElement) || blockElement;
  const blockRect = panelFinder.getElementRect(rootBlockBodyElement);
  const wrapperRect = panelFinder.getElementRect(wrapper);
  if (!blockRect || !wrapperRect) return null;

  const idealTop = standardizePrecision(blockElement.offsetTop);
  const idealLeft = standardizePrecision(
    blockRect.right - wrapperRect.left + ANNOTATION_HANDLE_RIGHT_OFFSET + ANNOTATION_PANEL_GAP
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
