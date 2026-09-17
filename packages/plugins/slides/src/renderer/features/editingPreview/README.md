# Editing preview

`editingPreview` 是编辑期间完整 RenderNode 视觉派生的唯一 owner。输入是当前正式节点与有序视觉操作，输出是一次性完成的节点；不持有第二份文稿、不写源码、不访问平台字体、不接管输入会话或提交队列。

## 边界

- `definitions/`：有序视觉操作及目标身份，复用 shared/authoringEditing 命令合同。
- `functions/projectEditingPreview`：按顺序投影删除、填充、尺寸与整框文字样式，发布完整节点。
- `functions/deriveTextPreview`：判断文字盒能否本地重排；使用 shared/textLayout 的正式字体事实、断行、autofit 和外框规则。
- `functions/collectEditingPreviewGeometries`：将相同节点交给 renderNodeSelection 的世界坐标算法；供选框、点击命中、工具条锚点和重入输入消费。

manualEditing 继续持有队列、平移和作者身份；editingInteraction 持有输入、IME、手势及失败草稿；elementProperties 只提交意图。Konva 节点直接调用本 feature 的窄 public index，不再加载 manualEditing 的业务编排。

## 完整更新合同

颜色不改变既有 run 分段，直接投影绘制字段。字号必须同时更新 run、slice 位置、换行、appliedFontScale 和必要的文本框高度。Shape 缩放先通过 shared 的 shapeTextResizeInput 派生默认字号、padding，再走同一排版入口。选框不再另写一份尺寸变换算法。

`preparedTextLayout` 与 RenderModel 修订绑定，保存 profile、autofit 之前的 inputBox、完整序列的测量事实和字体行指标。使用 inputBox 重新排版，避免连续放大／缩小把上一轮增高后的盒当成作者声明。字体单位由 portable text-measurement-core 在目标字号与字距下投影并统一舍入；不能缩放已经舍入的宽度或逐字拼接上下文 shaping。

当前只有盒几何可独立确定的 Text 可以即时重排：没有 Flex 编译证据的固定盒，或证据明确为 absolute 且同时声明宽高。自动宽高和 flow 依赖作者布局树，保留完整旧节点直到正式修订到达。缺失当前 shaping/metrics 事实也采用该交接；只有明确的 PreparedTextMeasurementUnavailable 会走这条路径，其他错误继续暴露。不得在这时先改字号、近似移动旧行、改用 Canvas 测量，或把猜测的盒交给命中判断。

所有计算同步完成，没有异步测量回包或额外 generation store。正式 revision 与队列的交接仍由 manualEditing 保证。WeakMap 只缓存当前基础节点最近一组输入的完整结果，基础节点替换后可回收；shared 的测量查询索引同样随 prepared 快照回收。

## 当前范围

输入中的 DOM 文本编辑以及提交后保留正文的 TextDraftPreview 仍归 textEditing。任意新正文／新的局部字体分段需要新 shaping 事实，不能拿旧 prepared 快照重排。这条 DOM→Canvas 边界尚未做到逐像素同源，本次没有用预览模块接管 caret、IME 或浏览器编辑器布局。文本内容与整框样式的排队顺序继续由 projectTextEditingValues 统一。

只读 standalone CLI 使用 prepareEditingMeasurements=false，不准备交互字体事实；本 feature 不引入 compiler、字体文件解析、PPTX 或写入依赖。

## 验证

- backend/engine/text 的 editingPreviewLayout 测试从正式 finalizer、严格 codec 到 renderer 预览，再与重新 finalization 比较：大／小／小数字号、左中右对齐、换行、shrink、resize-shape、连续修改、几何、回滚和不能本地求解的边界。
- renderModelTextLayout 测试覆盖 Shape 默认字号和紧凑 padding 阈值，以及只读关闭交互事实。
- manualEditing 与 editingInteraction 的流程测试覆盖命中、Frame 并集、旋转八方向缩放、输入重入和队列交接。
- smoke:preview-transitions 在 Chromium 的生产 Vue/Konva 和字号工具栏上逐帧比较预览与正式修订，写出 dist/dev/editing-preview-trace.json；同时运行已有原生指针、键盘、颜色、富文本、IME 与撤销重做验收。浏览器使用确定性测量 fixture；真实字体 shaping 和字号缓存复用由平台 HarfBuzz 集成测试验证。
