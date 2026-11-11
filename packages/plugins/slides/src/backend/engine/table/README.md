# Generated Table Layout

本模块拥有生成表格的固有尺寸、格线、默认字号与单元格占位规则。它处理表格内部布局，
不重新设计整页，也不修改 deck.js。Yoga、RenderModel mapper 与原生 PPTX compiler
通过窄入口 `resolveGeneratedTableLayout` 消费同一计算结果。

未声明高度时，以已分配列宽、单元格文本、局部字号、显式换行、padding 与合并跨度计算
固有高度；没有宽度约束时先测量固有列宽。测量复用 portable text measurement core 的
确定性估算，不依赖字体文件，也不冒充 Host 的最终 HarfBuzz 排版。最终质量仍由 text layout
与 inspect 判断，不能由“自动高度已算出”推断所有文字必然合适。

显式或 Flex 分配的高度是作者布局事实。空间不足时所有行同比压缩，富余空间分配给正文，行高总和必须等于盒高，
不能用正文最小行高扩大表格、把表头压成零。过小或零高度仍由质量链报告，不能在 mapper
补尺寸或丢弃节点。rowspan 占据的列由本模块统一跳过，渲染端不重新放置单元格。

没写逐格 `fill` 的单元格由 `resolveTableDefaultFills` 定底色：正文取表格所在页的纯色底
（`resolveTablePageColor`；页底是图片或渐变时取主题 `colors.background`），表头取 `accent1`
往正文底色里染 14%，没有强调色时往黑或白里提 5%。没写字色的单元格由 `resolveTableTextColor`
按自己的底色取主题文字色、`#333333`、近黑或白里第一个达到 4.5:1 的，深色页和深色逐格 `fill`
上的字自动反白。主题和页面都没写颜色时仍是白底、`#F2F2F2` 表头、`#333333` 字。RenderModel
mapper 与 PPTX compiler 把底色和字色都写进每个单元格，预览和导出不再各自兜底。
测试 `../../__tests__/table-border-and-fills.integration.test.ts` 同时锁住 `Table.border` 穿过
compose JSON 回读（Flex 编译写 `tableBorder`，Host reader 读编译字段）后预览与 PPTX 格线一致。

实现位于 `functions/`，输入与结果位于 `definitions/`。旧列宽权重和密度规则复用
`../visual/presentationVisualDefaults`；PptxGenJS、数据库与 Renderer 不进入计算函数。
测试 `../../__tests__/table-intrinsic-layout.integration.test.ts` 穿过 compose JSON 回读、
DeckSpec、RenderModel、单元格几何和真实 PPTX 格线，覆盖自动尺寸、显式压缩与跨行/跨列。
