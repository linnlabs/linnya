/**
 * 几何工具函数
 *
 * 英寸→px 转换、Box→CSS style 映射等，供元素组件和渲染器使用。
 */

import type { CSSProperties } from 'vue';
import type { Box } from '../types/api';
import { INCHES_TO_PX } from './constants';

/** 英寸转像素 */
export function inchesToPx(inches: number): number {
  return inches * INCHES_TO_PX;
}

/** 将 Box（英寸）转为绝对定位 CSS style 对象 */
export function boxToStyle(box: Box): CSSProperties {
  return {
    position: 'absolute',
    left: `${inchesToPx(box.x)}px`,
    top: `${inchesToPx(box.y)}px`,
    width: `${inchesToPx(box.w)}px`,
    height: `${inchesToPx(box.h)}px`,
  };
}
