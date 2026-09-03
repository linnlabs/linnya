/**
 * Konva Stage 响应式 composable
 *
 * 封装 Konva stage 的逻辑尺寸与缩放配置，
 * 使 KonvaSlideStage 模板层保持最薄。
 */

import { computed, type Ref } from 'vue';
import { INCHES_TO_PX, DEFAULT_SLIDE_SIZE } from '../../../shared/constants';
import type { RenderSlideSize } from '../../../types/render';

export interface KonvaStageOptions {
  /** 当前 slide 的尺寸（来自 render model） */
  slideSize: Ref<RenderSlideSize | null>;
  /** 当前已提交的 raster 缩放 */
  rasterScale: Ref<number>;
}

export function useKonvaStage(options: KonvaStageOptions) {
  /** 实际使用的 slide 物理尺寸（英寸） */
  const actualSlideSize = computed(() => {
    const s = options.slideSize.value;
    return s ? { width: s.width, height: s.height } : DEFAULT_SLIDE_SIZE;
  });

  /** 逻辑画布尺寸（px） */
  const logicalSize = computed(() => ({
    width: actualSlideSize.value.width * INCHES_TO_PX,
    height: actualSlideSize.value.height * INCHES_TO_PX,
  }));

  /** Konva Stage config（响应式） */
  const stageConfig = computed(() => ({
    width: logicalSize.value.width * options.rasterScale.value,
    height: logicalSize.value.height * options.rasterScale.value,
  }));

  /** 内容 layer 的 transform config：Konva 内部始终按已提交的 raster scale 绘制 */
  const contentTransform = computed(() => ({
    x: 0,
    y: 0,
    scaleX: options.rasterScale.value,
    scaleY: options.rasterScale.value,
  }));

  return {
    logicalSize,
    stageConfig,
    contentTransform,
  };
}
