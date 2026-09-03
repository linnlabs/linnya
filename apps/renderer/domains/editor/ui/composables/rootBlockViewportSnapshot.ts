import {
  ROOT_BLOCK_DOM_ATTRS,
  ROOT_BLOCK_DOM_CLASSES,
  ROOT_BLOCK_OUTER_SELECTOR,
} from '../../shared/rootBlockDomContract';

export { ROOT_BLOCK_OUTER_SELECTOR };
export const DEFAULT_NEAR_VIEWPORT_MARGIN_PX = 420;
const DEFAULT_VIEWPORT_SAMPLE_STEP_PX = 12;
const DEFAULT_VIEWPORT_SAMPLE_MAX_ITEMS = 360;
const DEFAULT_VIEWPORT_SAMPLE_X_FRACTIONS: readonly number[] = [0.15, 0.5, 0.85];

export interface CollectSampledViewportRootBlocksOptions {
  editorRoot: HTMLElement | null;
  scrollRoot: HTMLElement | null;
  maxItems?: number;
  rowStepPx?: number;
  xFractions?: readonly number[];
  includeBlockIds?: readonly string[];
}

export interface CollectNearViewportRootBlockIdsOptions {
  maxItems?: number;
  rowStepPx?: number;
  xFractions?: readonly number[];
  includeBlockIds?: readonly string[];
}

export function readRootBlockIdFromElement(el: HTMLElement): string | null {
  const id = el.dataset.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function escapeCssAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function findRootBlockOuterById(
  editorRoot: HTMLElement | null,
  blockId: string
): HTMLElement | null {
  if (!editorRoot || blockId.length === 0) return null;

  return editorRoot.querySelector<HTMLElement>(
    `.${ROOT_BLOCK_DOM_CLASSES.outer}[${ROOT_BLOCK_DOM_ATTRS.id}="${escapeCssAttributeValue(blockId)}"]`
  );
}

function findRootBlockOuterFromElement(
  target: Element,
  editorRoot: HTMLElement
): HTMLElement | null {
  const blockEl = target.closest(ROOT_BLOCK_OUTER_SELECTOR);
  if (!(blockEl instanceof HTMLElement)) return null;
  if (!editorRoot.contains(blockEl)) return null;
  return blockEl;
}

function addRootBlockCandidate(
  result: HTMLElement[],
  seen: Set<string>,
  el: HTMLElement | null,
  maxItems: number
): void {
  if (!el || result.length >= maxItems) return;

  const blockId = readRootBlockIdFromElement(el);
  if (!blockId || seen.has(blockId)) return;

  seen.add(blockId);
  result.push(el);
}

function collectRootBlocksByFullScan(
  editorRoot: HTMLElement | null,
  scrollRoot: HTMLElement | null,
  marginPx: number,
  maxItems: number,
  includeBlockIds: readonly string[] = []
): HTMLElement[] {
  if (!editorRoot) return [];

  const result: HTMLElement[] = [];
  const seen = new Set<string>();

  for (const blockId of includeBlockIds) {
    const el = findRootBlockOuterById(editorRoot, blockId);
    addRootBlockCandidate(result, seen, el, maxItems);
  }

  for (const el of editorRoot.querySelectorAll<HTMLElement>(ROOT_BLOCK_OUTER_SELECTOR)) {
    if (result.length >= maxItems) break;
    if (!isRootBlockNearViewport(el, scrollRoot, marginPx)) continue;
    addRootBlockCandidate(result, seen, el, maxItems);
  }

  return result;
}

function readSamplingViewportRect(
  editorRoot: HTMLElement,
  scrollRoot: HTMLElement | null
): Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'> | null {
  const editorRect = editorRoot.getBoundingClientRect();
  const scrollRect = scrollRoot?.getBoundingClientRect();
  const editorLeft = Number.isFinite(editorRect.left) ? editorRect.left : 0;
  const editorTop = Number.isFinite(editorRect.top) ? editorRect.top : 0;
  const editorRight = Number.isFinite(editorRect.right)
    ? editorRect.right
    : editorLeft + editorRect.width;
  const editorBottom = Number.isFinite(editorRect.bottom)
    ? editorRect.bottom
    : editorTop + editorRect.height;
  const viewportTop = scrollRect?.top ?? 0;
  const viewportRight = scrollRect?.right ?? window.innerWidth;
  const viewportBottom = scrollRect?.bottom ?? window.innerHeight;
  const viewportLeft = scrollRect?.left ?? 0;

  const top = Math.max(editorTop, viewportTop);
  const right = Math.min(editorRight, viewportRight);
  const bottom = Math.min(editorBottom, viewportBottom);
  const left = Math.max(editorLeft, viewportLeft);

  if (bottom <= top || right <= left) return null;
  return { top, right, bottom, left };
}

function buildSampleCoordinates(
  rect: Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>,
  rowStepPx: number,
  xFractions: readonly number[]
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  const width = rect.right - rect.left;
  const yStart = Math.ceil(rect.top + 1);
  const yEnd = Math.floor(rect.bottom - 1);
  const safeStep = Math.max(8, rowStepPx);
  const xs = xFractions.length > 0 ? xFractions : DEFAULT_VIEWPORT_SAMPLE_X_FRACTIONS;

  function pushRow(y: number): void {
    for (const fraction of xs) {
      const clampedFraction = Math.min(1, Math.max(0, fraction));
      points.push({
        x: rect.left + width * clampedFraction,
        y,
      });
    }
  }

  pushRow(yStart);
  for (let y = yStart + safeStep; y < yEnd; y += safeStep) {
    pushRow(y);
  }
  if (yEnd > yStart) pushRow(yEnd);

  return points;
}

/**
 * 采样当前视口内的 rootBlock DOM。
 *
 * 中文说明：
 * - 这里不能再用 querySelectorAll + getBoundingClientRect 全量扫描，否则万行文档首开会卡死；
 * - 通过 elementsFromPoint 在视口内按行采样，复杂度跟视口高度有关，和文档总块数无关；
 * - includeBlockIds 只用于补上 hover / selection 这类少量强制关注块，不允许塞大列表。
 */
export function collectSampledViewportRootBlocks(
  options: CollectSampledViewportRootBlocksOptions
): HTMLElement[] {
  const {
    editorRoot,
    scrollRoot,
    maxItems = DEFAULT_VIEWPORT_SAMPLE_MAX_ITEMS,
    rowStepPx = DEFAULT_VIEWPORT_SAMPLE_STEP_PX,
    xFractions = DEFAULT_VIEWPORT_SAMPLE_X_FRACTIONS,
    includeBlockIds = [],
  } = options;
  if (!editorRoot || maxItems <= 0) return [];

  if (typeof document.elementsFromPoint !== 'function') {
    return collectRootBlocksByFullScan(
      editorRoot,
      scrollRoot,
      DEFAULT_NEAR_VIEWPORT_MARGIN_PX,
      maxItems,
      includeBlockIds
    );
  }

  const result: HTMLElement[] = [];
  const seen = new Set<string>();

  for (const blockId of includeBlockIds) {
    const el = findRootBlockOuterById(editorRoot, blockId);
    addRootBlockCandidate(result, seen, el, maxItems);
  }

  const viewportRect = readSamplingViewportRect(editorRoot, scrollRoot);
  if (!viewportRect) return result;

  for (const point of buildSampleCoordinates(viewportRect, rowStepPx, xFractions)) {
    if (result.length >= maxItems) break;

    for (const target of document.elementsFromPoint(point.x, point.y)) {
      const rootBlock = findRootBlockOuterFromElement(target, editorRoot);
      if (!rootBlock) continue;
      addRootBlockCandidate(result, seen, rootBlock, maxItems);
      break;
    }
  }

  return result;
}

export function isRootBlockNearViewport(
  el: HTMLElement,
  scrollRoot: HTMLElement | null,
  marginPx = DEFAULT_NEAR_VIEWPORT_MARGIN_PX
): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.height === 0 && rect.width === 0) return false;

  const rootRect = scrollRoot?.getBoundingClientRect();
  const top = rootRect?.top ?? 0;
  const bottom = rootRect?.bottom ?? window.innerHeight;

  return rect.top < bottom + marginPx && rect.bottom > top - marginPx;
}

export function collectNearViewportRootBlockIds(
  editorRoot: HTMLElement | null,
  scrollRoot: HTMLElement | null,
  marginPx = DEFAULT_NEAR_VIEWPORT_MARGIN_PX,
  options: CollectNearViewportRootBlockIdsOptions = {}
): string[] {
  if (!editorRoot) return [];

  if (typeof document.elementsFromPoint === 'function') {
    return collectSampledViewportRootBlocks({
      editorRoot,
      scrollRoot,
      maxItems: options.maxItems,
      rowStepPx: options.rowStepPx,
      xFractions: options.xFractions,
      includeBlockIds: options.includeBlockIds,
    }).flatMap((el) => {
      const blockId = readRootBlockIdFromElement(el);
      return blockId ? [blockId] : [];
    });
  }

  return collectRootBlocksByFullScan(
    editorRoot,
    scrollRoot,
    marginPx,
    options.maxItems ?? DEFAULT_VIEWPORT_SAMPLE_MAX_ITEMS,
    options.includeBlockIds
  ).flatMap((el) => {
    const blockId = readRootBlockIdFromElement(el);
    return blockId ? [blockId] : [];
  });
}
