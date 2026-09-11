import { createRadialGradientScene } from '../radialGradientScene';
import type { SlideBackgroundModel } from '../../../../types/render';
import { SLIDES_RENDER_COLORS } from '../../../../shared/constants';
import { resolveKonvaShapeFillConfig } from '../konvaVisualMapping';

export function buildBackgroundRectConfig(
  background: SlideBackgroundModel,
  logicalSize: { width: number; height: number },
) {
  return {
    x: 0,
    y: 0,
    width: logicalSize.width,
    height: logicalSize.height,
    ...(background.paint.type === 'none'
      ? { fill: SLIDES_RENDER_COLORS.slideBackground }
       : background.paint.type === 'radial'
        ? createRadialGradientScene(background.paint, logicalSize.width, logicalSize.height, () => {
          const path = new Path2D();
          path.rect(0, 0, logicalSize.width, logicalSize.height);
          return path;
        })
        : resolveKonvaShapeFillConfig(background.paint, logicalSize.width, logicalSize.height)),
    // 页面背景必须覆盖完整画布；预览圆角属于 SlideStage 的 UI 外壳，不能进入共享页面像素。
    name: background.paint.type === 'linear' || background.paint.type === 'radial'
      ? 'slide-background-gradient-base'
      : 'slide-background-color-base',
  };
}

export function buildBackgroundImageConfig(
  logicalSize: { width: number; height: number },
  image: HTMLImageElement,
) {
  return {
    x: 0,
    y: 0,
    width: logicalSize.width,
    height: logicalSize.height,
    image,
  };
}
