/**
 * 画布缩放计算
 *
 * 根据容器尺寸和画布逻辑尺寸计算最佳缩放比，使画布 fit 到容器中央。
 */

import {
  DEFAULT_SLIDE_SIZE,
  INCHES_TO_PX,
} from './constants';

/** 适应模式 */
export type FitMode = 'contain' | 'width' | 'height';

export interface SlideSize {
  width: number;
  height: number;
}

function toLogicalSize(slideSize: SlideSize) {
  return {
    width: slideSize.width * INCHES_TO_PX,
    height: slideSize.height * INCHES_TO_PX,
  };
}

/**
 * 计算让画布适配容器的缩放比
 *
 * @param containerWidth  容器可用宽度
 * @param containerHeight 容器可用高度
 * @param mode            适应模式，默认 contain（保持宽高比完全可见）
 * @param padding         容器内边距（px），默认 32
 */
export function computeFitScale(
  containerWidth: number,
  containerHeight: number,
  slideSize: SlideSize = DEFAULT_SLIDE_SIZE,
  mode: FitMode = 'contain',
  padding = 32,
): number {
  const availableW = Math.max(containerWidth - padding * 2, 1);
  const availableH = Math.max(containerHeight - padding * 2, 1);
  const logicalSize = toLogicalSize(slideSize);

  const scaleW = availableW / logicalSize.width;
  const scaleH = availableH / logicalSize.height;

  switch (mode) {
    case 'width':
      return scaleW;
    case 'height':
      return scaleH;
    case 'contain':
    default:
      return Math.min(scaleW, scaleH);
  }
}

/**
 * 计算画布在容器中居中的偏移量
 */
export function computeCenterOffset(
  containerWidth: number,
  containerHeight: number,
  slideSize: SlideSize = DEFAULT_SLIDE_SIZE,
  scale: number,
): { x: number; y: number } {
  const logicalSize = toLogicalSize(slideSize);
  const canvasW = logicalSize.width * scale;
  const canvasH = logicalSize.height * scale;
  return {
    x: Math.max((containerWidth - canvasW) / 2, 0),
    y: Math.max((containerHeight - canvasH) / 2, 0),
  };
}
