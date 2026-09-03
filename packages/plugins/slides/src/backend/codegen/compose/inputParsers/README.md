# Compose Input Parsers

本目录是 deck.js compose/flex 字段族解析的唯一权威。它只负责把不可信输入校验并归一为 shared 合同，不负责页面设计、布局求解、编辑状态重放或 I/O。

包级边界见 [`../../../../../README.md`](../../../../../README.md)，Paint 合同见 [`../../../../../docs/visual-paint-contract.md`](../../../../../docs/visual-paint-contract.md)。

## 文件与依赖

```text
inputParsers/
├── typeGuards.ts      # 通用类型守卫与字符串集合解析
├── parseContext.ts    # ParseWarning 通道与路径派生
├── styleParsers.ts    # TextStyle、ShapeStyle、图片阴影、Box、Theme
└── dataParsers.ts     # 图表、表格、图片与 SVG authoring source
```

依赖只允许 `typeGuards/parseContext -> styleParsers -> dataParsers`。解析器可以依赖 `@plugin/slides/shared`，禁止反向依赖 tools、engine、renderer 或旧 host 迁移目录。

## 单一事实来源

| 字段族 | 权威入口 |
|---|---|
| 文本样式 | `parseTextStyle` |
| 形状样式与 Paint | `parseShapeStyle` |
| 图片阴影 | `parseImageVisualShadow` |
| 几何盒 | `parsePartialBox` |
| Theme | `readThemeSpecInput` |
| 图表 | `parseChartDataLike` / `parseChartSeries` |
| 表格 | `parseTableDataLike` / `parseTableCell` |
| 图片与 SVG 来源 | `parseImageSourceInput` / `parseSvgGraphicAuthoringSource` |

禁止在 compose、Flex compiler 或新工具中复制这些字段族解析。历史上同一图片阴影、颜色和 `isRecord` 曾在多入口重复实现并产生静默差异；新增能力必须扩展这里的具名函数。

## 有限兼容

| 入口 | 兼容 | 目标 |
|---|---|---|
| `parseTableCell` | `text/content/value` | `cell.text` |
| `parseTableCell` | `fill/bgColor/backgroundColor` | `cell.fill` |
| `parseTableCell` | 顶层 TextStyle 短字段 | `cell.style` |
| `parseTableDataLike` | styled header cells | promote 为首行 `rows` |

新增别名必须同时补正常映射、优先级和错误类型测试。别名不能进入 shared 类型。

## ParseWarning 与容错

`parseContext.ts` 提供 `createParseContext`、`field/index` 路径派生、去重与格式化。编排层创建根 context，parser 只追加稳定 warning facts；禁止手拼路径或把 warning 当作自动修复。

| 场景 | 处理 |
|---|---|
| 整体不是 record | 拒绝 |
| 必填字段缺失或类型错 | 拒绝 |
| 可选字段类型错 | 拒绝该字段所在合同 |
| 可选字段缺失 | 不写入返回对象 |
| 未知字段 | 按当前入口的 warning 策略报告，不扩展 shared 合同 |

不要通过 fallback、默认矩形或静默吞字段让错误输入“看起来能跑”。

## 测试

- `__tests__/styleParsers*.test.ts`
- `__tests__/dataParsers*.test.ts`
- `__tests__/parseContext.test.ts`
- `../../__tests__/parseWarningsChannel.test.ts`
- `packages/plugins/slides/src/backend/tools/presentationTools.test.ts`
