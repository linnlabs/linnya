# Color Palette Domain

`color-palette` 把 `@linnya/color-core/palette` 的纯算法接到 Host：解码图片、校验入参、把结果投影成跨边界 DTO、给出稳定错误码。配色算法和口径见 [Color Core](../../../packages/color-core/README.md)。

## 入口

| 入口 | 调用方 | 图片来源 |
| --- | --- | --- |
| `linnya palette suggest\|check` | Agent 的受管 Shell，见 [Core CLI](../../app-hosts/linnya/application/core-cli/README.md) | 当前对话工作目录 |
| `@plugin/backend/colorPalette` | 插件 Backend | 插件自己读好的内存 bytes |

两条路径都调用本 domain，不复制取色、校验或错误码。Renderer 做预览和换色时直接用纯算法包，不经过这里。

## 职责

- `orchestration/colorPalettes.ts`：`suggestColorPalettes` 与 `checkColorPalette`。入参按 `@app/schemas/color-palette` 校验，可预期的失败以 `status: 'failed'` 返回。
- `functions/projectColorPalette.ts`：结果投影。DTO 只有 hex、名称和枚举，不带 OKLCH、打分或中性色候选；调用方需要时用 `@linnya/color-core` 从 hex 计算。
- `functions/renderPalettePreview.ts`：把几套配色画成 RGBA 色条，不写文字，不依赖字体。

## 不变量

- 本 domain 不读路径、资产或数据库，不写文件。文件边界归调用方。
- 图片只接受 JPEG、PNG、WebP，按文件头判断。解码缩到长边 128 px，是算法要求的输入尺寸。
- 单张解不开时跳过并报告下标；图片全部解不开且没有种子色或指定色时返回 `image_unreadable`。
- 同样的图片、选项和编号（`rng`）得到逐字节相同的结果。

## 错误码

| 错误码 | 含义 |
| --- | --- |
| `invalid_options` | 选项不合法：颜色写法、套数、强调色数量等 |
| `too_many_images` | 超过 20 张 |
| `invalid_rng` | 编号不是配色建议输出的 |
| `image_unreadable` | 图片全部读不出来 |
| `no_subject_color` | 图片里取不出彩色 |
| `pinned_color_neutral` | 指定色是黑白灰，没有色相 |
| `pinned_color_conflict` | 指定色在要求的底色上达不到对比度 |
