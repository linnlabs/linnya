/**
 * 封面构图的编号。单独成文件：presentation build Worker 只引用 directionContract 的声明 schema，
 * 发方向与工具结果才需要这份列表，放在这里不会打进 Worker。
 */
export const COVER_COMPOSITION_IDS = [
  'center-axis',
  'bottom-band',
  'top-masthead',
  'right-title',
  'vertical-axis',
  'type-fill',
  'mosaic',
  'left-title',
] as const;
export type CoverCompositionId = (typeof COVER_COMPOSITION_IDS)[number];
