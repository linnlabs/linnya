# Slides 编辑交互会话

`editingInteraction` 是有限编辑的交互编排 owner：统一画布选择、拖动、原位文字输入、IME、退出和失败草稿恢复。它消费 `manualEditing` 的作者目标、命中／视觉规则与提交端口，消费 `textEditing` 的 DOM 目标合同。两个下游 feature 都不反向依赖本模块。

## 两种独立生命周期

- **输入会话**：`idle → editing → idle`，`editing` 内明确保存 sessionId、目标、draft、baseline、composing 和 finishRequested。结束输入是同步动作，不等待 IPC、编译、刷新或画面呈现。
- **异步写入**：由 `manualEditing/useManualEditQueue` 独立负责。入队返回带 clientOperationId 的 ticket，最终明确返回 presented、failed、blocked 或 cancelled。相邻可合并意图共享 commandId，每个调用方仍收到自己的回执。

点击 B 时先结束 A 的输入，再立即选择 B；A 的内容成为无焦点预览。再次双击 A 读取最近的本地内容。回执只按 clientOperationId 结算对应预览，不能关闭、覆盖或重新聚焦当前会话。选择、输入和队列之间没有全局 pending 布尔边沿，也没有超时解锁。

## 边界和不变量

- 交互入口集中在 `useSlideEditingInteraction`；指针会话锁定按下时的作者层级，低层 resize gesture 继续由 manualEditing 负责。输入期间不显示 resize/property controls，DOM pointer 事件不冒泡为画布拖动。
- 普通 Enter 交给原生 textarea 换行；Ctrl/Cmd+Enter 结束输入；Escape 取消当前尚未交接的草稿。快捷键或显式画布点击可以把焦点交回画布，后台结果绝不执行 focus。
- IME 确认键不提交。组合输入期间的 blur 记录 finishRequested；compositionend 先接纳 DOM 最终值，再完成交接，避免丢最后一个字。
- 文本预览使用 `pointer-events: none`，不形成输入框或命中目标。它随统一作者几何的移动、尺寸和样式投影更新；删除预览会隐藏相关文字。正式帧到达后撤下，只保留一份可见文字。
- 预览是会话内草稿，不修改 RenderModel，不是第二份可写文档模型，也不参与 compiler。DOM 的换行外观不是最终 HarfBuzz 排版；重排和 autofit 仍由正式编译负责。未提交／失败草稿不跨文档关闭持久化。
- 写入失败保留该目标最新的文字，用户双击即可继续或原样重试。失败不会把用户从其他对象拉回来。后续依赖意图收到 blocked，界面明确说明未提交；不能默默用旧版本继续写入。
- 文档切换由页面装配层重置交互 store；页内切换只结束当前输入，保留同一文档待结算的草稿。视觉版本刷新只更新编辑几何，不能覆盖当前 draft 或 baseline。

## 模块布局

| 位置 | 职责 |
| --- | --- |
| definitions | 会话、临时文字展示和入口端口合同 |
| functions | 开始会话、按操作身份结算、临时文字几何投影 |
| store | 同步持有并替换会话和文字预览，不发 IPC，不控制焦点 |
| orchestration | 选择／手势和输入交接，关联 ticket，执行局部焦点效果 |

## 参考设计

[tldraw Editor](https://tldraw.dev/sdk-features/editor) 与 [Input handling](https://tldraw.dev/sdk-features/input-handling) 将工具交互状态和文档状态分开；这里借鉴明确状态所有权、统一事件入口，而不引入整个编辑器或新的状态机依赖。[Konva Editable Text](https://konvajs.org/docs/sandbox/Editable_Text.html) 使用 DOM 输入叠在 Canvas 之上；这里复用原生 textarea 的输入法、换行和选区能力，并为异步写入补全独立回执生命周期。

## 验证

- `orchestration/useSlideEditingInteraction.test.ts` 验证父级优先、兄弟切换、背景、位移／尺寸投影、删除，以及保存等待期间的立即选择。
- `orchestration/editingWorkflow.test.ts` 组合生产输入会话与真实提交队列，覆盖延迟响应／视觉帧、同目标重入、合并回执、同步拒绝、失败草稿、依赖失败、刷新重试、文档 A→B→A 的迟到响应和 IME。
- `smoke:preview-transitions` 在 Electron 原生输入下挂载完整生产 SlideStage 和同一提交队列，只替换 IPC／文稿读取端口。检查普通 Enter、双击 Shape、外部点击、Ctrl+Enter、Escape、IME 事件、等待中再次编辑、旧回执不夺焦点、失败恢复及 Stage 正式帧结算；保留原有属性和 resize 冒烟。
- 这些合成文稿测试不替代默认用户文稿的保存、重新打开、历史或导出验收。

启用 `localStorage['linnya.slides.debug'] = 'verbose'` 后，`EditingInteraction` 记录 text_open、text_handoff、text_settled；`ManualEditQueue` 记录 clientOperationIds 到 commandId 的绑定及结算。与既有 ManualEditTrace 串联，不记录用户文字或源码。
