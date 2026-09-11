# Slides 创作保真度验收记录

日期：2026-09-11。环境：macOS，本地 Node/Electron；基准提交为 `86b0c405`。

## 正式行为与 owner

| 范围 | 现在的合同 | 回归入口 |
| --- | --- | --- |
| Flex | 数字 flex 映射 grow/shrink/basis；无 flex 的显式主轴尺寸不压缩；AT_MOST 返回内容宽度与约束的较小值 | `codegen/compose/flex-layout` 测试 |
| 自动宽度 | Backend 落库前调用最终排版同源 provider；保留锚点、minWidth 与测量来源；默认 inset 与诊断一致 | `engine/text/__tests__/materializeIntrinsicTextBoxes.test.ts`、真实 HarfBuzz smoke |
| 字体 | macOS 扫描包含按需字体资产；生成文本按 grapheme 回退，数字不被缺少的汉字连带替换 | 平台 font-resolution 与 Slides font-resolution-integration 测试 |
| Paint | direction/angle 二选一；按 OOXML scaled 语义归一化；径向渐变保留双轴半径，命中画布独立处理 | paint/OOXML 测试、真实 8 角度与 2:1 椭圆像素 smoke |
| 图表 | legendColor、plotBackgroundColor、seriesLineWidth 进入预览和 PPTX；无 grid 图表独立画绘图区；饼图图例使用分类名、留出图例通道并允许标签换行 | chart mapper/compiler 测试、pie/radar 绘图区像素 smoke |
| 诊断 | background/decoration、节点 bleed、chrome 角色；细线遮挡考虑透明度/z 序/相交比例；纯符号补字不增加正文字体族 | generated-layout-constraint-evidence、aesthetic/layout lint 测试 |
| CLI | 构建缓存、args-file、omit-args、error diagnostics 非零退出、projects、统一 JSON 格式、finding action | CLI 子进程测试与 inspection 测试 |
| 页身份 | 保留源码行区间，嵌套 createSlide 直接给出真实原因 | slideMarkerIndex 测试 |

自动宽度只校正无横向约束的绝对定位生成文本，固定盒、正常 Flex 换行和 imported PPTX 盒继续遵循各自合同。Worker 不获得字体文件系统能力；临时启发式与最终测量来源保持可观察。没有加入粗体经验系数或隐藏安全余量。

字体脚本继续使用现有 latin/eastAsian/complex 公共合同。纯符号的 fallback 不参与正文字体族数量，但字体替换和未解析诊断仍保留，避免以修改统计掩盖缺字。

## 本机结果

- Slides 严格 TypeScript/Vue 类型检查通过；全量 1714 项测试通过、2 项跳过；随后新增的 3 个透明度/层级业务回归独立通过。
- Conversation CLI 22 项测试通过，包含真实子进程 `projects`、JSON 文件参数与失败退出语义；CLI 类型检查通过。
- Conversation control/bridge 与平台字体测试共 69 项通过；schemas 的 build、打包与产物合同 smoke 通过。
- `smoke:raster-worker` 通过：8 角度、2:1 椭圆、pie/radar 绘图区与透明图例通道、系统中西文字体、末字裁剪和 screenshot orchestration。
- 真实 HarfBuzz：Avenir Next 下 150pt 粗体 `02` 与 8pt/3pt 字距 `DEEP CANOPY` 自动宽度无横向或纵向溢出。该探针要求 source 为 harfbuzz，不能靠 heuristic 自洽通过。
- standalone `fonts check --family "PingFang SC" --format json` 返回 installed=true。
- 后端、Renderer 构建通过。后端包体约 15.77 MiB，接近现有 16 MiB 上限，新增重依赖需继续通过 bundle guard。
- 改动文件 ESLint、样式 strict gate 与 `git diff --check` 通过。

## 尚未覆盖的外部验收

- 未重放原始 16 页本地业务文稿；本记录使用可入库的自包含测试与真实运行时探针，不能据此声称该文稿的 P0 数量已经下降。
- 未在 Windows 或 Microsoft PowerPoint 中完成逐页像素比对。已有 OOXML 合同测试与 macOS Renderer 实测通过，但不替代跨平台视觉验收。
- 全仓类型债务门禁仍失败：记录基线为 169，隔离复跑原提交实际为 184；修改后同为 184，按文件和 TS 错误码对比无新增、无减少。没有上调基线。Slides 和 CLI 的严格 owner 检查独立通过。
