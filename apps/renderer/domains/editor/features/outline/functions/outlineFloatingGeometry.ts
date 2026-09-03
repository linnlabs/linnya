export interface OutlineFloatingBounds {
  hostTop: number;
  hostHeight: number;
  viewportHeight: number;
  edgeGap: number;
}

export interface OutlineTriggerTopInput extends OutlineFloatingBounds {
  triggerHeight: number;
  triggerAnchorRatio?: number;
}

export interface OutlinePanelTopInput extends OutlineFloatingBounds {
  anchorTop: number;
  anchorHeight: number;
  itemCount: number;
  itemHeight: number;
  listVerticalPadding: number;
  minPanelHeight: number;
  maxPanelHeight: number;
}

function normalizeFiniteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function resolveSafeVerticalRange(input: OutlineFloatingBounds): { safeTop: number; safeBottom: number } {
  const edgeGap = Math.max(0, normalizeFiniteNumber(input.edgeGap, 0));
  const hostTop = normalizeFiniteNumber(input.hostTop, 0);
  const hostHeight = Math.max(0, normalizeFiniteNumber(input.hostHeight, 0));
  const viewportHeight = Math.max(0, normalizeFiniteNumber(input.viewportHeight, hostTop + hostHeight));

  const safeTop = Math.max(edgeGap, hostTop + edgeGap);
  const safeBottom = Math.max(safeTop, Math.min(viewportHeight - edgeGap, hostTop + hostHeight - edgeGap));

  return { safeTop, safeBottom };
}

export const OUTLINE_DEFAULT_TRIGGER_ANCHOR_RATIO = 0.3;

export function calculateOutlineTriggerTop(input: OutlineTriggerTopInput): number {
  const { safeTop, safeBottom } = resolveSafeVerticalRange(input);
  const triggerHeight = Math.max(0, normalizeFiniteNumber(input.triggerHeight, 0));
  const hostTop = normalizeFiniteNumber(input.hostTop, 0);
  const hostHeight = Math.max(0, normalizeFiniteNumber(input.hostHeight, 0));
  const triggerAnchorRatio = clampNumber(
    normalizeFiniteNumber(input.triggerAnchorRatio ?? OUTLINE_DEFAULT_TRIGGER_ANCHOR_RATIO, OUTLINE_DEFAULT_TRIGGER_ANCHOR_RATIO),
    0,
    1
  );
  const preferredTop = hostTop + hostHeight * triggerAnchorRatio - triggerHeight / 2;

  // 中文说明：触发条属于当前文件窗口的边缘控件，位置应在中线偏上；
  // 这样用户扫编辑区上半部时更容易发现，同时仍按当前文件窗口而不是整个 app 定位。
  return Math.round(clampNumber(preferredTop, safeTop, safeBottom - triggerHeight));
}

export function estimateOutlinePanelHeight(input: OutlinePanelTopInput): number {
  const { safeTop, safeBottom } = resolveSafeVerticalRange(input);
  const availableHeight = Math.max(0, safeBottom - safeTop);
  const minPanelHeight = Math.max(0, normalizeFiniteNumber(input.minPanelHeight, 0));
  const maxPanelHeight = Math.max(minPanelHeight, normalizeFiniteNumber(input.maxPanelHeight, minPanelHeight));
  const itemCount = Math.max(0, Math.floor(normalizeFiniteNumber(input.itemCount, 0)));
  const itemHeight = Math.max(0, normalizeFiniteNumber(input.itemHeight, 0));
  const listVerticalPadding = Math.max(0, normalizeFiniteNumber(input.listVerticalPadding, 0));
  const naturalHeight = Math.max(minPanelHeight, itemCount * itemHeight + listVerticalPadding);

  return Math.round(Math.min(naturalHeight, maxPanelHeight, Math.max(minPanelHeight, availableHeight)));
}

export function calculateOutlinePanelTop(input: OutlinePanelTopInput): number {
  const { safeTop, safeBottom } = resolveSafeVerticalRange(input);
  const panelHeight = estimateOutlinePanelHeight(input);
  const anchorTop = normalizeFiniteNumber(input.anchorTop, safeTop);
  const anchorHeight = Math.max(0, normalizeFiniteNumber(input.anchorHeight, 0));
  const anchorCenter = anchorTop + anchorHeight / 2;
  const centeredTop = anchorCenter - panelHeight / 2;

  // 中文说明：短目录应该围绕触发条展开，长目录才向上吃满更多空间。
  // 这样不同长度的 outline 不会都从同一个死 top 弹出。
  return Math.round(clampNumber(centeredTop, safeTop, safeBottom - panelHeight));
}
