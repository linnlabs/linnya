# Color Palette Domain

`color-palette` 把 `@linnya/color-core/palette` 的纯算法接到 Host：解码图片、校验入参、把结果投影成跨边界 DTO、给出稳定错误码。配色算法和口径见 [Color Core](../../../packages/color-core/README.md)。

## 入口

| 入口 | 调用方 | 图片来源 |
| --- | --- | --- |
| `linnya palette suggest\|check\|use` | Agent 的受管 Shell，见 [Core CLI](../../app-hosts/linnya/application/core-cli/README.md) | 当前对话工作目录 |
| `@plugin/backend/colorPalette` | 插件 Backend（`suggestColorPalettes`、`useColorPalette` 带插件的工作区连接） | 插件自己读好的内存 bytes |

两条路径都调用本 domain，不复制取色、校验或错误码，也共用同一份“最近用过”：Agent 用 CLI 拿到的编号，插件可以用 `useColorPalette` 记下，反之亦然。Renderer 做预览和换色时直接用纯算法包，不经过这里。

## 职责

- `orchestration/colorPalettes.ts`：`suggestColorPalettes`、`useColorPalette` 与 `checkColorPalette`。入参按 `@app/schemas/color-palette` 校验，可预期的失败以 `status: 'failed'` 返回。前两个经 `ColorPaletteHistoryPort`（`definitions/colorPaletteHistory.ts`）读写最近用过。
- `infrastructure/sqlite/`：最近用过的两张表、schema provider 与仓储 `createSqliteColorPaletteHistory`。
- `functions/projectColorPalette.ts`：结果投影。DTO 只有 hex、名称和枚举，不带 OKLCH、打分或中性色候选；调用方需要时用 `@linnya/color-core` 从 hex 计算。
- `functions/renderPalettePreview.ts`：把几套配色画成 RGBA 色条，不写文字，不依赖字体。

## 最近用过

调用方选定一套后用 `use <单套编号>` 告诉系统，之后的建议对同一**组合**降权。组合 = 底色明暗 + 色系集合（如 染纸·绿+黄），与挑选时衡量差异的主维度相同：只换深浅、色系相同的几套，用户看来是同一种配色。降权规则和取值在纯算法包（[Color Core](../../../packages/color-core/README.md#最近用过)），这里只负责存取。

- **归工作区**：两张表在工作区数据库里，不分项目，删除工作区即删除。只存组合（底色明暗与色系名），不存色值和图片。
- `color_palette_suggestions`：每次建议记下整组编号、每套的组合，以及当时用来降权的最近用过。`use` 只拿到编号，靠它查出组合；只留最近 100 组，更早的编号 `use` 时报 `palette_not_found`。
- `color_palette_uses`：选用记录，只留降权要看的最近 15 次。同一套再选一次移到最前，不占两个位置。
- **复现**：带 `rng` 时用这组发出时存下的最近用过，所以选用其中一套之后再复现，结果仍逐字节相同。这组编号没在本工作区发出过（或已清理）时，按现在的最近用过算。
- 表由 schema provider 建立（create-only，不提升 Schema 版本）；已有库启动时补建空表。

## 不变量

- 本 domain 不读路径和资产，不写文件，文件边界归调用方。数据库只读写上面两张表，连接由调用方给：CLI 用 Host 的工作区连接，插件门面用插件交来的同一库连接。
- 图片只接受 JPEG、PNG、WebP，按文件头判断。解码缩到长边 128 px，是算法要求的输入尺寸。
- 单张解不开时跳过并报告下标；图片全部解不开且没有种子色或指定色时返回 `image_unreadable`。
- 同样的图片、选项和编号（`rng`）在同一工作区里得到逐字节相同的结果（最近用过按上面的复现规则取）。

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
| `palette_not_found` | `use` 的编号不是本工作区最近 100 组建议里的单套编号 |
