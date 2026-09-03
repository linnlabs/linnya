# Workspace Tree Node Mutations

本 feature 编排侧边栏节点的创建、重命名、复制、删除及提交后的树刷新。

- Store 只注入响应式状态 action 和树刷新能力；
- 文档创建通道由 DocumentType registry 决定，不在 Store 猜测插件实现；
- mutation 失败统一映射 Workspace 结构化错误；
- 公开 Store API 保持兼容，但异步业务流程由本 orchestration 持有。
