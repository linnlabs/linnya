# Generated layout replay

本模块拥有 generated 页面在编辑期间重排所需的跨端编译事实。它与诊断用的
[generatedLayoutConstraints](../generatedLayoutConstraints/README.md) 分开：不从最终盒反推作者树，
不携带可执行源码、资产或绘制样式，也不是 deck.js 可写 API。

## 合同与数据流

Flex compiler 从实际 Yoga 节点读取归一化后的 points 样式、父子关系与原始兄弟顺序；
Text 附带同一次编译使用的正文、固有宽度及 portable 测量输入。正文仅用于重放该次
measureFunc；它不替代 RenderModel 的段落、字形或编辑草稿。

`layoutReplay` 随 DirectSlideInput 的可信编译出口进入 DeckSpec、RenderModel 与统一修订快照。
严格 schema 同时验证节点身份唯一、父节点先于子节点和唯一根节点。布局节点 ID 与
RenderNode 的 layoutConstraintEvidence 对应；人工图层排序只改绘制顺序，重排仍按原始 order。
新增空白页只迁移后续页面 ID，无须重编布局；快照传输把 ID 放入 binding，布局内容继续按页复用。

Backend 的 `YogaReplayStyle` 读取编译样式；Renderer editingPreview 的 `computeLayoutReplay`
接收同版本 Yoga、快照和宽度覆盖，创建当前页节点，
计算后释放。配置与编译器一致：web defaults、无像素取整、LTR、72 points/inch。
shared 只保留合同和准入，不加载 Yoga 或 WASM；Renderer 不维护长期布局树或缓存。

## 可重排范围

普通 Text、Frame 与其他由尺寸/Flex 决定布局的节点可重排；完整页面作为一个结果发布。
含 Table 或不可移植 Text 测量 adapter 的页面不产出快照，不能把上次测量高度当成新的
measureFunc。空白页不产出无用快照。旧修订保持可读，下一次成功完整编译自然生成，
不在打开时重写或迁移文稿。

布局回放只计算 Yoga 盒；最终文字断行、autofit、字形与选区由
[editingPreview](../../renderer/features/editingPreview/README.md) 和
[textLayout](../textLayout/README.md) 处理。已确认的人工平移属于布局后投影，Renderer 以
布局差值更新正式盒，保留平移；既有位置的 1e-4 英寸量化可能造成最多一个格点的误差。

## 修改与验证

新增 Yoga 样式映射必须同步更新 readYogaReplayStyle、schema 与回放入口，不能只改 compiler。
宽度的 Backend 独立投影也必须更新快照中的 width，保证后续 flow 编辑基线一致。

`backend/engine/text/__tests__/flowWidthPreview.integration.test.ts` 对照完整编译，覆盖嵌套
Flex、居中/拉伸、连续宽度、无 editKey 的兄弟、人工位移、绘制排序及内容/定位分块往返。
原生 Chromium 的 preview-transitions smoke 验证输入、Canvas、选区和正式帧交接。
