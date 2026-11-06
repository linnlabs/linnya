import type { CustomSelectOption } from '@linnya/renderer-ui';

/** 与滚轮缩放（canvasZoomCamera）相同的倍率范围；加减按钮每步 1.25 倍。 */
export const CANVAS_ZOOM_LIMITS = { min: 0.02, max: 4 } as const;
export const CANVAS_ZOOM_STEP = 1.25;
const PRESETS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 4] as const;

export type CanvasZoomMenuValue = 'fit' | (typeof PRESETS)[number];

/** 与 Slides 缩放菜单同序：先“显示全部”，分隔后是常用档位；快捷键与画布键盘一致。 */
export function canvasZoomMenuOptions(): readonly CustomSelectOption<CanvasZoomMenuValue>[] {
  return [
    { value: 'fit', text: '显示全部', shortcut: '⌘1' },
    { isSeparator: true },
    ...PRESETS.map(value => ({
      value,
      text: `${value * 100}%`,
      ...(value === 1 ? { shortcut: '⌘0' } : {}),
    })),
  ];
}

/** 当前倍率恰好是某个档位时在菜单里打勾；连续缩放到非档位时不勾任何项。 */
export function canvasZoomPreset(zoom: number): CanvasZoomMenuValue | null {
  return PRESETS.find(value => Math.abs(value - zoom) < 0.005) ?? null;
}
