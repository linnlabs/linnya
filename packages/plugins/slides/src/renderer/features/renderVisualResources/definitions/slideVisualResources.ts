import type { SlideRenderModel } from '../../../types/render';
import type { SlideChartResourceMap } from '../../renderChartResources';
import type { SlideImageResourceMap } from '../../renderImageResources';

export interface SlideVisualResources {
  imageResources: SlideImageResourceMap;
  chartResources: SlideChartResourceMap;
}

/** 舞台一次提交的完整视觉帧；三者不能拆开更新。 */
export interface ReadySlideVisualFrame extends SlideVisualResources {
  slide: SlideRenderModel;
}
