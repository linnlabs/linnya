import type { CustomSelectOption } from '@linnya/renderer-ui';
import type { StageZoomMenuAction, StageZoomMode } from '../definitions/stageZoomTypes';

/** 常用缩放档位；均位于舞台 25%–300% 缩放范围内。 */
export const STAGE_ZOOM_PRESET_PERCENTS = [25, 50, 75, 100, 150, 200] as const;

const FIT_VALUE = 'fit';

export function buildStageZoomMenuOptions(input: {
  readonly zoomMode: StageZoomMode;
  readonly zoomPercent: number;
  readonly fitLabel: string;
  readonly formatPercent: (percent: number) => string;
}): CustomSelectOption<string>[] {
  return [
    { value: FIT_VALUE, label: input.fitLabel, selected: input.zoomMode === 'fit' },
    { isSeparator: true },
    ...STAGE_ZOOM_PRESET_PERCENTS.map(percent => ({
      value: String(percent),
      label: input.formatPercent(percent),
      // fit 恰好算出同一百分比时仍以“适应窗口”为当前项，避免两个选中态。
      selected: input.zoomMode === 'manual' && input.zoomPercent === percent,
    })),
  ];
}

export function resolveStageZoomMenuAction(value: string): StageZoomMenuAction | null {
  if (value === FIT_VALUE) return { kind: 'fit' };
  const percent = STAGE_ZOOM_PRESET_PERCENTS.find(preset => String(preset) === value);
  return percent === undefined ? null : { kind: 'percent', percent };
}
