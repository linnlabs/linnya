# Editing preview

`editingPreview` 是编辑期间完整 RenderNode 视觉派生的唯一 owner。输入是当前正式节点与有序视觉操作，或新增对象的完整作者值，输出是完整临时节点；不持有第二份文稿、不写源码、不访问平台字体、不接管输入会话或提交队列。

## 边界

- `definitions/`：有序视觉操作及目标身份，复用 shared/authoringEditing 命令合同。
- `functions/projectEditingPreview`：按顺序投影删除、填充、尺寸、文本宽度与整框文字样式，发布完整节点。
- `functions/projectEditingPreviewSlide`：重放当前页的 flow 宽度编辑，一次发布受影响文字、容器与兄弟节点。
- `orchestration/useSlideEditingPreview`：页面就绪时惰性加载同版本 Yoga；通过窄 projector 把同一结果提供给绘制、选区与命中。
- `functions/deriveTextPreview`：判断文字盒能否本地重排；使用 shared/textLayout 的正式字体事实、断行、autofit 和外框规则。
- `functions/collectEditingPreviewGeometries`：将相同节点交给 renderNodeSelection 的世界坐标算法；供选框、点击命中、工具条锚点和重入输入消费。

manualEditing 继续持有队列、平移和作者身份；editingInteraction 持有输入、IME、手势及失败草稿；elementProperties 只提交意图。Konva 节点直接调用本 feature 的窄 public index，不再加载 manualEditing 的业务编排。

## 完整更新合同

颜色不改变既有 run 分段，直接投影绘制字段。字号必须同时更新 run、slice 位置、换行、appliedFontScale 和必要的文本框高度。Shape 缩放先通过 shared 的 shapeTextResizeInput 派生默认字号、padding，再走同一排版入口。选框不再另写一份尺寸变换算法。

`preparedTextLayout` 与 RenderModel 修订绑定，保存 profile、autofit 之前的 inputBox、完整序列的测量事实和字体行指标。使用 inputBox 重新排版，避免连续放大／缩小把上一轮增高后的盒当成作者声明。字体单位由 portable text-measurement-core 在目标字号与字距下投影并统一舍入；不能缩放已经舍入的宽度或逐字拼接上下文 shaping。

整框字号预览只重排盒几何可独立确定的 Text：没有 Flex 编译证据的固定盒，或证据明确为 absolute 且同时声明宽高。宽度预览通过 shared/generatedLayoutConstraints 的独立文字判定：有明确左边和宽度的绝对定位固定高度框，以及具有编译器自动高度测量输入、明确顶边的自动高度框。自动高度先重放 Yoga 的同源估高，再用正式 shaping/metrics 做最终换行和 autofit；连续调整更新 prepared 的 inputBox，不能累计上次可见高度。局部投影遇到宽度 min/max、自动高度仅底边锚定或缺少测量输入时，保留完整旧节点直到正式修订到达。旧文稿缺少新增输入时，第一次完整编译自然补齐，不从已有最终外框猜测作者规则。缺失当前 shaping/metrics 事实也采用该交接；只有明确的 PreparedTextMeasurementUnavailable 会走这条路径，其他错误继续暴露。不得在这时先改字号、近似移动旧行、改用 Canvas 测量，或把猜测的盒交给命中判断。

flow Text 的宽度编辑消费 [generatedLayoutReplay](../../../shared/generatedLayoutReplay/README.md) 的编译快照，用与 Backend 相同的 Yoga 重排当前页。基础布局和本次布局的差值作用于正式节点，保留编译后的人工平移；改变宽度的文字使用既有 prepared 字形事实做最终排版，无 editKey 的兄弟也需要准备这些事实。绘制、选区与命中必须经同一个页面 projector，不能只更新被拖的框。页面预览只保留最近一组输入的结果，不复制文稿或维护长期布局树；手势、队列和正式帧交接保持原 owner。含表格或定制测量的页面不产出 replay；受影响的图片/图表等需要改变内部尺寸、或队列先有未确认的新正文/字体时，仍等待正式结果。不能只投影一部分受影响节点。

既有对象的视觉计算同步完成，没有异步测量回包或额外 generation store。正式 revision 与队列的交接仍由 manualEditing 保证。WeakMap 只缓存当前基础节点最近一组输入的完整结果，基础节点替换后可回收；shared 的测量查询索引同样随 prepared 快照回收。

## 当前范围

输入中的 DOM 文本编辑以及提交后保留正文的 TextDraftPreview 仍归 textEditing。任意新正文／新的局部字体分段需要新 shaping 事实，不能拿旧 prepared 快照重排。这条 DOM→Canvas 边界尚未做到逐像素同源，本次没有用预览模块接管 caret、IME 或浏览器编辑器布局。文本内容与整框样式的排队顺序继续由 projectTextEditingValues 统一。

只读 standalone CLI 使用 prepareEditingMeasurements=false，不准备交互字体事实；本 feature 不引入 compiler、字体文件解析、PPTX 或写入依赖。

## 验证

- backend/engine/text 的 editingPreviewLayout 测试从正式 finalizer、严格 codec 到 renderer 预览，再与重新 finalization 比较：大／小／小数字号、左中右对齐、换行、shrink、resize-shape、连续修改、几何、回滚和不能本地求解的边界。
- renderModelTextLayout 测试覆盖 Shape 默认字号和紧凑 padding 阈值，以及只读关闭交互事实。
- manualEditing 与 editingInteraction 的流程测试覆盖命中、Frame 并集、旋转八方向缩放、输入重入和队列交接。
- smoke:preview-transitions 在 Chromium 的生产 Vue/Konva 和字号工具栏上逐帧比较预览与正式修订，写出 dist/dev/editing-preview-trace.json；同时运行已有原生指针、键盘、颜色、富文本、IME 与撤销重做验收。浏览器使用确定性测量 fixture；真实字体 shaping 和字号缓存复用由平台 HarfBuzz 集成测试验证。

## 新增对象的待保存预览

`projectInsertionPreview` 只派生可确定的纯色基础形状和带本地来源的图片；文字与带字 Shape 缺少正式 shaping 事实时保留既有占位。临时节点没有 authoringRef 或 source span，不参与正式选区、历史、缩略图和导出。

`useInsertionPreview` 调用 renderVisualResources 的公开资源帧入口，复用图片 registry，不新建解码器或缓存。Konva 的 PendingInsertionLayer 消费完整节点与资源，不写业务规则。队列只持有原始意图，不能存第二份 RenderModel。

正式节点出现后，`unpresentedInsertions` 按 editKey 排除对应临时节点，处理 push 先于提交回包的顺序。资源入口会保留上一帧，因此临时层还要用当前待保存集合过滤已就绪内容：失败、切页、正式接管立即撤下，不等待其他图片完成。取消后的异步资源不能复活临时节点。

原生 smoke 检查确认前的 Shape/Image 像素、正式帧只接管一次与撤下；流程测试覆盖慢资源期间确认和取消的交错。

文本宽度的原生 smoke 覆盖独立固定／自动高度及真实编译的 flow 页面、连续多次 pointermove、保存中再次拖动、左侧锚点、两次正式帧交接、Escape 与保存失败；同时比较文字切片和选区，不能只检查虚线框。
