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
- `maxSrgbChroma`（给定明度与色相的 sRGB 最大彩度，用于相对彩度）
- `normalizeHue`、`hueDistance`、`isHueWithinArc`
- `simulateColorVisionDeficiency`、`COLOR_VISION_DEFICIENCY_MATRICES`（矩阵也可直接用于 SVG `feColorMatrix`，其默认在线性 RGB 中运算）

## 取色与配色：`@linnya/color-core/palette`

`suggestPalettes(input)` 从调用方解码好的图片（RGBA，建议长边 128 px，最多 20 张，第一张是主图）和/或种子色出发，返回题材本色、中性色候选、排除的色相区间和若干套配色。它不解码图片、不读文件；图片怎么来由调用方决定。

1. **量化**：每张图在 33³ RGB 直方图上做 Wu 量化，再在 OKLab 里做按像素数加权的 k-means。画面中心的像素权重为 1，边角降到 0.5。
2. **找本色**：彩度太低或过暗过亮的颜色只算中性色。彩色按色相聚成族（种子色相 ±18°，族不沿色环漂移）。代表色分开平均明度与彩度，色相按“占比 × 彩度”求圆形平均。打分以占比为主，出现在几张图里和接近目标彩度为辅；只在一张非主图里出现的降权。最多选 3 种，彼此色相相差 30°–120°：更远的颜色落在对侧，不与主本色同稿。主图至少占全部权重的四分之一，不被其余图片稀释。
3. **排除区**：每种本色对侧 150°–210°，加上 `avoidColors` 两侧各 30°。相隔不超过 12° 的两段合成一段。
4. **风格基因**：一套配色由几维组成。
   - **离散维度**：关系（同色系、邻近色、墨色主导、双本色）× 底色明暗（浅底、染纸、深底）× 底面变体 × 色调。
     - 底面变体：浅底有带本色、偏冷、纯白三种，染纸有淡、纸两种，深底有近黑和本色深底（藏青、墨绿一类）两种。
     - 色调借鉴日本色研 PCCS：浅底与染纸上有本色、柔、浊、深、暗、强、灰，深底上有本色、浅、柔、明、灰。
   - **连续维度**：图表首尾明度、彩度收尾比例、同色系图表的色相漂移（Cubehelix 的思路），以及邻近色的偏转角。
   - **色调与彩度**：色调用 OKLCH 明度加相对彩度定义，相对彩度 = 彩度 ÷ `maxSrgbChroma`，同一档在不同色相上看起来一样鲜。
5. **采样**：每次按先验权重采样 240 个候选，先验只决定出现频率。生成时检查：
   - **对比度**：在期望明度附近二分查找，保证 `ink` ≥ 7:1、`muted` ≥ 4.5:1、`accent` ≥ 3:1（对 `bg`）。
   - **图表系列**：按明度单调排列；浅端彩度减半，避免糖果色。
   - **排除区**：所有有彩颜色都避开排除区，并留 6° 余量。
   - **底色**：染纸避开 45°–100° 的米色带，彩度不超过本色彩度的一半。
   - 不合规的候选直接丢掉。
6. **评分**：显式规则的系数之积。以下情况降分：
   - 暗黄绿：Palmer–Schloss 2010，阈值同 Material DislikeAnalyzer，换算到 OKLCH。
   - 点题与墨太近。
   - 图表相邻两档太近。
   - 有彩底配高彩点题。
7. **按差异挑选**：用 `paletteDistance` 衡量两套的差异：底、点题、图表权重大，墨与弱墨权重小，底色明暗、关系、色调不同各加一点。
   - 第一套从高分段里按分数加权抽。
   - 之后每套与已选各套的距离不低于门槛：从 0.16 起，逐步放宽到 0。满足门槛的候选里优先没用过的关系，再按分数加权抽。
   - 这是 O'Donovan 2011 给多条建议的做法，相当于贪心 MMR。
8. **可复现**：结果编号（`pl` + 4 位 base36）就是随机种子。同样输入加同一 `rng` 结果逐字节相同；不传则每次不同。

生成颜色时用 `oklchToRgb(..., { jnd: 0 })`：严格保持色相，排除区判断才可靠。取色本身是确定的，随机只用在采样风格基因和挑选上。黑白图、拓片取不出彩色时返回 `{ kind: 'no_subject_color' }`，不编造颜色。

常量集中在 `src/palette/definitions/paletteConstants.ts`，数值来自三组真实用图的离线样张。改动前先重出样张对照。三组真实用图各跑 100 次，同一把尺子（`paletteDistance`）对照改造前的“关系 × 底色查表”版本：一次内 3 套两两最小距离从 0.09–0.10 提到 0.16；可区分配色（距离 ≥ 0.05）从 6–13 种提到 54–75 种。一次连取色约 11–45 ms。

## 消费方

- Editor 图表（`apps/renderer/domains/editor/features/chart-reading`）：细线色派生与填充内文字色。

## 验证

`pnpm exec vitest run packages/color-core`：已知值、往返误差、两种色域映射、ΔEOK、色觉模拟、色相区间、解析与混色；配色部分覆盖取色、对侧色排除、无彩图、随机 1000 次的排除区、对比度与图表明度单调、一次 3 套两两距离、100 次里可区分配色的下限、编号复现与 10 张图 500 ms 性能上限。CSS Color 4 映射曾与 colorjs.io 的 `toGamut({ method: 'css' })` 在 4560 个 OKLCH 采样点上对照，最大差 ΔEOK 0.012（近黑处 1 个通道值）。
