# Slides 原位文字视图

`textEditing` 只负责正式 RenderModel 到原位 DOM 文字的投影、原生 textarea 和无焦点文字预览。交互会话、草稿和 IME 状态由 [`editingInteraction`](../editingInteraction/README.md) 唯一拥有；提交与 revision 呈现由 [`manualEditing`](../manualEditing/README.md) 负责。本模块没有独立 pending、store 或提交 watcher。

## 合同

- `createTextEditingTarget` 消费世界坐标几何及 Text 或 Shape.innerText，仅接受 backend 声明的 plain_text 作者能力。富文本和公式不能被整体字符串替换。
- 目标保存作者身份、当前内容、原点、尺寸、旋转、padding、垂直偏移和文字样式；不读取 Konva 实例或 DOM 测量来反写作者事实。
- `InlineTextEditor` 按 Stage 比例投影 inches/pt。sessionId 是组件 key，双击打开后聚焦到末尾。textarea 不因保存而 disabled，普通 Enter 保留浏览器默认换行。
- compositionend 先发送最终 DOM 值，再通知会话组合输入结束。blur、组合输入和快捷键由上层会话统一处理。
- `TextDraftPreview` 以相同样式显示交接后的内容，pointer-events 为 none，不接受焦点、输入或选择。Stage 把当前输入与预览对应的 ID 集合传入 Konva，仅隐藏重复的文字，保留 Shape 的 fill/stroke。
- Shape 文字和独立 Text 使用同一输入组件。唯一蓝色边界由 Canvas 选框拥有，DOM 不增加第二个边框或焦点环。
- Shape 拉伸的本地预览只重对齐已有正式行，不在浏览器重建文本测量器；正式换行／autofit 仍由 backend text finalization 拥有。

`InlineTextEditor.css` 通过 renderer `slidesStylesheets` 注册，安装产物走 Host stylesheet 生命周期，不增加 SFC 样式旁路。

## 验证

`functions/createTextEditingTarget.test.ts` 与 `createInlineTextEditorStyle.test.ts` 验证作者能力及视觉坐标。完整交接与失败恢复见 editingInteraction 的组合测试；生产 Stage／原生 Enter 和 Shape 双击见 `smoke:preview-transitions`。
