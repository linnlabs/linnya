/**
 * 前端 ViewModel 类型
 *
 * 由 slidesMapper 从后端 DTO 映射而来，UI 组件直接消费这些类型。
 * 前端不应直接把后端 DTO 传给 UI 组件——映射层可以在此做字段归一化、默认值填充、
 * 以及前端独有的派生计算（如 px 坐标）。
 */

import type { Box, AssetRef, PreviewWarning } from './api';

/** 单个元素的前端视图模型 */
export interface ElementViewModel {
  elementId: string;
  type: 'text' | 'chart' | 'table' | 'image' | 'svgGraphic' | 'formula' | 'shape' | 'group' | 'other';
  text?: string;
  /** 英寸坐标，与后端一致 */
  position?: Box;
  chartType?: string;
  imageRef?: AssetRef;
}

/** 单页的前端视图模型 */
export interface SlidePreviewViewModel {
  slideId: string;
  number: number;
  layoutName?: string;
  elements: ElementViewModel[];
}

/** 主题的前端视图模型 */
export interface ThemeViewModel {
  colors: Record<string, string>;
  fonts: { major: string; minor: string };
}

/** 整个 Deck 的前端视图模型 */
export interface DeckPreviewViewModel {
  nodeId: string;
  versionNumber: number;
  title: string;
  slideSize: { width: number; height: number };
  slides: SlidePreviewViewModel[];
  theme: ThemeViewModel;
  warnings: PreviewWarning[];
}

/** Inspector 面板 tab 枚举 */
export type InspectorTab = 'overview' | 'diagnostics' | 'suggestions';
