# Editor 文档设置

本 feature 通过 Settings contribution 提供 Markdown 文档设置页。文档界面偏好由 `editorDocumentSettingsStore` 持有；AI 补全开关、延迟、频率和长度继续通过既有 `aiSettings` 的公开 action 更新。迁移滑块不会改变这些字段的持久化位置或业务取值语义。

`EditorAiInteractionSettingsSection` 使用 `@linnya/renderer-ui` 的 `CustomSlider` 默认密度；三个范围分别为 1–5、1–6、1–3，自动补全关闭时均禁用。组件通过数值型 v-model 接入原有 computed/action，外部状态更新直接投影回原生 input。

设置页只拥有单位、等级标签、开关依赖和外围布局。轨道进度、滑钮、键盘与焦点反馈由 Renderer UI 唯一拥有；不再保留原生 range CSS、input ref 或 watch/nextTick 进度同步。测试验证开关联动、三个值各自的 action 及外部更新。
