import { ZOOM_MAX, ZOOM_MIN, ZOOM_SLIDER_STEP, ZOOM_STEP } from '../../../shared/constants';

/** 缩放控件以整数百分比工作；UI store 仍保存倍率。 */
export const STAGE_ZOOM_PERCENT_MIN = Math.round(ZOOM_MIN * 100);
export const STAGE_ZOOM_PERCENT_MAX = Math.round(ZOOM_MAX * 100);
export const STAGE_ZOOM_PERCENT_STEP = Math.round(ZOOM_STEP * 100);
export const STAGE_ZOOM_PERCENT_SLIDER_STEP = Math.round(ZOOM_SLIDER_STEP * 100);

export function clampStageZoomPercent(percent: number): number {
  return Math.max(STAGE_ZOOM_PERCENT_MIN, Math.min(STAGE_ZOOM_PERCENT_MAX, percent));
}
