import type { CanvasQualityException } from './canvasQuality';

// 只登记经过职责审查的精确函数/上限，不能按目录放行；全插件最多五项。
export const canvasQualityExceptions: readonly CanvasQualityException[] = [];
