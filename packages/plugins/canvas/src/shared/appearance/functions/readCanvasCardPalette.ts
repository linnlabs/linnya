import type { CanvasColor } from '../../model/definitions/canvasElement';
import type { CanvasCardCssPalette, CanvasCardPalette } from '../definitions/canvasCardPalette';

// OKLCH染纸与同色深墨的sRGB投影，DOM与Pixi共同消费，避免两个颜色解析器产生差异。
const light: Readonly<Record<CanvasColor, CanvasCardPalette>> = {
  white: { paper: 0xffffff, title: 0x1b1b18, body: 0x3e3d3b, muted: 0x757472 },
  red: { paper: 0xfdece7, title: 0x35201a, body: 0x513d37, muted: 0x826c66 },
  orange: { paper: 0xfdeddf, title: 0x322314, body: 0x4e3f32, muted: 0x7e6e60 },
  yellow: { paper: 0xf8f0d7, title: 0x2d2611, body: 0x484230, muted: 0x78715e },
  green: { paper: 0xebf3e6, title: 0x202a18, body: 0x3c4635, muted: 0x6b7664 },
  cyan: { paper: 0xe5f3f7, title: 0x102b32, body: 0x30464d, muted: 0x5e767d },
  purple: { paper: 0xf5edf6, title: 0x2f2131, body: 0x4a3d4c, muted: 0x7a6c7c },
};
const dark: Readonly<Record<CanvasColor, CanvasCardPalette>> = {
  white: { paper: 0x232321, title: 0xecebe8, body: 0xbfbebb, muted: 0x878683 },
  red: { paper: 0x352a26, title: 0xf8e7e2, body: 0xd2c0ba, muted: 0xa18d88 },
  orange: { paper: 0x352a20, title: 0xf5e9de, body: 0xcfc1b6, muted: 0x9e8f83 },
  yellow: { paper: 0x352b1b, title: 0xf2eadd, body: 0xccc3b5, muted: 0x9a9181 },
  green: { paper: 0x292f25, title: 0xe6eee1, body: 0xbfc7b9, muted: 0x8d9686 },
  cyan: { paper: 0x252e31, title: 0xddeff4, body: 0xb5c8ce, muted: 0x82969c },
  purple: { paper: 0x302a31, title: 0xf2e7f3, body: 0xcbc0cd, muted: 0x9a8d9b },
};
export function readCanvasCardPalette(color: CanvasColor, isDark: boolean): CanvasCardPalette {
  return (isDark ? dark : light)[color];
}
export function readCanvasCardCssPalette(
  color: CanvasColor,
  isDark: boolean
): CanvasCardCssPalette {
  const palette = readCanvasCardPalette(color, isDark),
    css = (value: number) => `#${value.toString(16).padStart(6, '0')}`;
  return {
    paper: css(palette.paper),
    title: css(palette.title),
    body: css(palette.body),
    muted: css(palette.muted),
  };
}

// 分区是比卡纸更淡的染纸底：浅色在页面底与卡纸之间，深色略亮于页面底；标题用同色系弱墨。
const sectionLight: Readonly<Record<CanvasColor, number>> = {
  white: 0xf0f0ee,
  red: 0xfbf1ee,
  orange: 0xfbf3ea,
  yellow: 0xfaf5e6,
  green: 0xf2f7ef,
  cyan: 0xeef7fa,
  purple: 0xf7f1f7,
};
const sectionDark: Readonly<Record<CanvasColor, number>> = {
  white: 0x2e2e2c,
  red: 0x352b28,
  orange: 0x342c24,
  yellow: 0x332d22,
  green: 0x2c3128,
  cyan: 0x283033,
  purple: 0x312b32,
};
export function readCanvasSectionPalette(
  color: CanvasColor,
  isDark: boolean
): { readonly fill: number; readonly title: number } {
  return {
    fill: (isDark ? sectionDark : sectionLight)[color],
    title: readCanvasCardPalette(color, isDark).muted,
  };
}
