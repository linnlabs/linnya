import type { CanvasColor } from '../../model/definitions/canvasElement';
export type CanvasLinePalette = Readonly<Record<Exclude<CanvasColor, 'white'>, number>>;

// 与纸面共用色相；Chromium将正式OKLCH中间墨色投影为sRGB，默认白线仍由主题中性墨色控制。
const light: CanvasLinePalette = { red: 0xb97968, orange: 0xb18154, yellow: 0x9f8b4d, green: 0x799761, cyan: 0x4799af, purple: 0xa57bab };
const dark: CanvasLinePalette = { red: 0xc68f80, orange: 0xbe9671, yellow: 0xb59a6c, green: 0x8ea87b, cyan: 0x6aa9bc, purple: 0xb390b9 };
export function readCanvasLinePalette(isDark: boolean): CanvasLinePalette { return isDark ? dark : light; }
