import type { ParsedColor, RgbChannels } from '../definitions/color.js'

const HEX_FULL = /^#([0-9a-f]{6})$/i
const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i
const FUNCTIONAL = /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)))
}

/**
 * 解析 `#RRGGBB`、`#RGB`，以及 `rgb()` / `rgba()`（浏览器里 CSS token 经 canvas 解析后的形式）。
 * 其他写法（颜色名、`var()`、`oklch()` 等）返回 null，由调用方决定降级方式，不猜颜色。
 */
export function parseColor(color: string): ParsedColor | null {
  const text = color.trim()
  if (HEX_FULL.test(text)) {
    const value = text.slice(1)
    return {
      channels: [
        Number.parseInt(value.slice(0, 2), 16),
        Number.parseInt(value.slice(2, 4), 16),
        Number.parseInt(value.slice(4, 6), 16),
      ],
      alpha: 1,
    }
  }
  if (HEX_SHORT.test(text)) {
    const red = text.charAt(1)
    const green = text.charAt(2)
    const blue = text.charAt(3)
    return {
      channels: [Number.parseInt(red + red, 16), Number.parseInt(green + green, 16), Number.parseInt(blue + blue, 16)],
      alpha: 1,
    }
  }
  const functional = FUNCTIONAL.exec(text)
  if (functional) {
    const [, red, green, blue, alpha] = functional
    const alphaValue = alpha === undefined ? 1 : alpha.endsWith('%') ? Number.parseFloat(alpha) / 100 : Number.parseFloat(alpha)
    return {
      channels: [clampChannel(Number(red)), clampChannel(Number(green)), clampChannel(Number(blue))],
      alpha: Math.min(1, Math.max(0, alphaValue)),
    }
  }
  return null
}

/** 通道取整后输出小写 `#rrggbb`。 */
export function toHex(channels: RgbChannels): string {
  return `#${channels.map(channel => clampChannel(channel).toString(16).padStart(2, '0')).join('')}`
}

/** 在 `from` 与 `to` 之间按 sRGB 通道线性混色（输出 `#rrggbb`，忽略透明度）；任一颜色无法解析时原样返回 `from`。 */
export function mixColors(from: string, to: string, ratio: number): string {
  const a = parseColor(from)
  const b = parseColor(to)
  if (!a || !b) return from
  const t = Math.min(1, Math.max(0, ratio))
  const blend = (index: 0 | 1 | 2) => a.channels[index] + (b.channels[index] - a.channels[index]) * t
  return toHex([blend(0), blend(1), blend(2)])
}

/**
 * 给颜色叠加透明度（已有透明度相乘）。无法解析的颜色返回 `transparent`：
 * 用于辅助线、指示带这类“淡”元素，宁可不画，也不能因为格式不认识而画成不透明的色块。
 */
export function withAlpha(color: string, alpha: number): string {
  const parsed = parseColor(color)
  if (!parsed) return 'transparent'
  const [red, green, blue] = parsed.channels
  const combined = Math.round(Math.min(1, Math.max(0, alpha)) * parsed.alpha * 1000) / 1000
  return `rgba(${red}, ${green}, ${blue}, ${combined})`
}
