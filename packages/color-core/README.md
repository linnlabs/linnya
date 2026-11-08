# Color Core

`@linnya/color-core` 是仓库里颜色运算的唯一 owner：颜色解析、sRGB / 线性 sRGB / OKLab / OKLCH 互转、色域处理、混色与 WCAG 对比度。它不读文件、不存数据、不认识图表、文档格式或插件；同样输入得到同样输出，Renderer、App Server、Worker 和插件都可以直接引用。

先例是 `@linnya/text-measurement-core`：业务包只保留自己的规则和阈值，不再复制颜色公式。

## 口径

| 项 | 口径 |
| --- | --- |
| 色相、彩度 | OKLCH（Björn Ottosson 公式） |
| 对比度 | WCAG 2.x 相对亮度；sRGB 线性化阈值 0.04045，对 8 位通道与 WCAG 文中的 0.03928 结果相同 |
| 解析 | `#RRGGBB`、`#RGB`、`rgb()` / `rgba()`；其他写法返回 null，不猜颜色 |
| 输出 | `toHex` 取整并截到 0–255，输出小写 `#rrggbb` |
| 色域 | `oklchToRgb` 超出 sRGB 时按 CSS Color 4 映射：保持明度与色相、二分降低彩度，剪裁误差小于 ΔEOK 0.02 即停。低彩度时这点剪裁会让色相偏几度，按色相判断颜色关系的调用方传 `{ jnd: 0 }`，只降彩度、明度与色相严格不变 |
| 色差 | ΔEOK（OKLab 欧氏距离） |
| 色觉异常 | Machado、Oliveira、Fernandes 2009 严重度 1.0 矩阵，作用在线性 sRGB 上；是最坏情况 |

## 公开入口

- `parseColor`、`toHex`、`mixColors`、`withAlpha`
- `rgbToOklab`、`oklabToLinearRgb`、`oklabToOklch`、`oklchToOklab`、`rgbToOklch`、`oklchToRgb`、`isLinearRgbInGamut`、`srgbChannelToLinear`、`linearToSrgbChannel`
- `relativeLuminance`、`contrastRatio`、`deltaEOK`
- `normalizeHue`、`hueDistance`、`isHueWithinArc`
- `simulateColorVisionDeficiency`、`COLOR_VISION_DEFICIENCY_MATRICES`（矩阵也可直接用于 SVG `feColorMatrix`，其默认在线性 RGB 中运算）

## 消费方

- Editor 图表（`apps/renderer/domains/editor/features/chart-reading`）：细线色派生与填充内文字色。

## 验证

`pnpm exec vitest run packages/color-core`：已知值、往返误差、两种色域映射、ΔEOK、色觉模拟、色相区间、解析与混色。CSS Color 4 映射曾与 colorjs.io 的 `toGamut({ method: 'css' })` 在 4560 个 OKLCH 采样点上对照，最大差 ΔEOK 0.012（近黑处 1 个通道值）。
