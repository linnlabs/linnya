import type { CanvasChromeColors } from '../../definitions/canvasKernel';

/** 没有 DOM 主题时（隐藏出图、CLI 预览、探针）的界面色，与浅色/暗色主题的默认外观一致。 */
export function canvasStandaloneChrome(dark: boolean): CanvasChromeColors {
  return dark
    ? { accent: 0x347b45, background: 0x222723, ink: 0xe8e9e3, label: 0xb5bcb3 }
    : { accent: 0x347b45, background: 0xf2f3ee, ink: 0x252c27, label: 0x626b61 };
}
