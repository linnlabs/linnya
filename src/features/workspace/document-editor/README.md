# Workspace Document Editor

本 feature 负责富文档 Editor 读写入口的 Workspace 边界：确认 `workspace_nodes` 身份，再按节点类型调用 Host 注入的窄 provider。它不拥有 Markdown、Slides、MindMap 等文档内部格式。

```text
IPC / Document Surface
  -> readWorkspaceEditorDocument / writeWorkspaceEditorDocument
     -> Workspace 节点身份
     -> Host provider resolver
        -> 永久内建 Markdown document-editor
        -> 或已启用插件的 Editor hook
```

普通 `text/markdown` 预览不经过本 feature。只有已经获得 Workspace 文档节点身份、且对应文档类型声明了 Editor provider 的内容才能进入富文档读写链。

未知类型、禁用插件和缺少对应 Editor 动作必须明确拒绝，不能默认落入 Markdown 持久化。插件数据库实例通过 Host adapter 收窄为 `DocumentTypeBackendDatabase`，不得直接获得 `better-sqlite3` 完整实例。
