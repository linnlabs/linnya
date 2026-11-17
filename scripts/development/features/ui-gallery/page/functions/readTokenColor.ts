import {
  contrastRatio,
  rgbToOklch,
  toHex,
  type Oklch,
  type RgbChannels,
} from '@linnya/color-core';

/**
 * 读取 token 在当前主题与方案下的实际颜色。
 *
 * token 常写成 color-mix() 或半透明色，自定义属性的计算值只是原文；把它画到 1×1 画布上再读像素，
 * 得到的就是屏幕上真正出现的 sRGB 值。传入背景 token 时先画背景再叠前景，半透明色按实际叠加结果计算。
 */
export interface TokenColorReading {
  readonly hex: string;
  readonly oklch: Oklch;
  readonly channels: RgbChannels;
}

let canvasContext: CanvasRenderingContext2D | null = null;

function context(): CanvasRenderingContext2D {
  if (canvasContext) return canvasContext;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const created = canvas.getContext('2d', { willReadFrequently: true });
  if (!created) throw new Error('浏览器不支持 2D canvas，无法读取 token 颜色');
  canvasContext = created;
  return created;
}

function resolveCssColor(token: string, host: Element): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${token})`;
  host.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

export function readTokenColor(token: string, over: string | null, host: Element): TokenColorReading {
  const paint = context();
  paint.clearRect(0, 0, 1, 1);
  if (over !== null) {
    paint.fillStyle = resolveCssColor(over, host);
    paint.fillRect(0, 0, 1, 1);
  }
  paint.fillStyle = resolveCssColor(token, host);
  paint.fillRect(0, 0, 1, 1);
  const [red, green, blue] = paint.getImageData(0, 0, 1, 1).data;
  const channels: RgbChannels = [red, green, blue];
  return { hex: toHex(channels), oklch: rgbToOklch(channels), channels };
}

export function readTokenContrast(foreground: string, background: string, host: Element): number {
  const back = readTokenColor(background, null, host);
  const front = readTokenColor(foreground, background, host);
  return contrastRatio(front.channels, back.channels);
}

/** 色温审阅最需要的三个数：明度、彩度、色相。彩度很低时色相没有意义，不显示。 */
export function formatOklch(oklch: Oklch): string {
  const lightness = oklch.l.toFixed(3);
  const chroma = oklch.c.toFixed(3);
  return oklch.c < 0.002 ? `L ${lightness} · C ${chroma}` : `L ${lightness} · C ${chroma} · H ${Math.round(oklch.h)}`;
}

/** 从已装载的样式表里收集某个前缀的自定义属性名，色阶增减时画廊自动跟上。 */
export function collectCustomPropertyNames(prefix: string): string[] {
  const names = new Set<string>();
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        for (const property of Array.from(rule.style)) {
          if (property.startsWith(prefix)) names.add(property);
        }
      } else if (rule instanceof CSSGroupingRule) {
        visit(rule.cssRules);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    visit(sheet.cssRules);
  }
  return [...names].sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));
}
