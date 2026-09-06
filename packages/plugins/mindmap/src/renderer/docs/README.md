# Mindmap Renderer

Mindmap Renderer 负责把一个 Markdown 风格的文本大纲呈现为可编辑的树形画布。

## 当前边界

- 节点的核心内容是 `topic` 文本和 `children` 层级。
- 画布保留折叠、选择、移动、重排、连接、摘要、撤销重做和视口恢复等编辑能力。
- 侧边栏上下文和 Agent 的文档读取都输出带节点短引用的缩进大纲。
- Mindmap 不承载假设、证据、置信度、验证状态或专用研究工作流；这些内容属于独立的研究 deck。

## 目录入口

| 目录 | 职责 |
| --- | --- |
| `core.ts` | 组装 MindMap 内核和运行时能力 |
| `domain/` | 节点、选择、命令、事务和状态 |
| `interaction/` | 鼠标、键盘、拖拽和意图路由 |
| `presentation/` | 画布引擎、工具栏、菜单和节点编辑器 |
| `features/autoRefresh/` | 文档版本变化后的刷新编排 |
| `tool-cards/` | `mindmap_create_node` 工具结果卡片 |
| `utils/mindmapAiContext.ts` | 侧边栏使用的带 NodeRef 文本大纲 |

## 数据约定

Mindmap 的持久化事实保存在 `mindmap_versions.content_json`。文本导入通过
`shared/mindmapOutline.ts` 解析和规范化，导出时只取根节点与子节点的主题文本。

## 修改前阅读

1. 先读 `packages/plugins/mindmap/AGENTS.md`（如果存在）和本目录相邻说明。
2. 修改数据格式时读 `src/shared/mindmapOutline.ts`、`src/shared/mindMapData.ts` 和后端 document hook。
3. 修改交互时读对应 `domain/commands/`、`interaction/intents/` 和相邻测试。
4. 修改 Agent 能力时同时读 `src/backend/tools/mindmap/README.md` 与 `src/backend/agents/subagent_mindmap_editor/`。

## 验证

```bash
pnpm --filter @plugin/mindmap test
pnpm --filter @plugin/mindmap typecheck
```

完成后还要运行 `git diff --check`，并确认插件的 backend/renderer 公开入口没有重新引入研究专用实现。
