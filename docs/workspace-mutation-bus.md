# Workspace Mutation Bus

Workspace Mutation Bus 是 linnya 的工作区事实变更通知机制。它不是一个单独业务模块，而是一条 app-level 基础设施链路：后端在 workspace node、document version、resource library 真实写入成功后发布 typed event；前端根据事件刷新文件树、当前文档 surface、Markdown pending revisions 和资源库。

它的目标是让 UI 感知“工作区发生了什么事实变化”，而不是猜“哪个 agent / tool 可能改了东西”。因此主 agent、subagent、用户手动操作、插件 hook、后台编排只要落到同一写入层，就会走同一刷新机制。

设计与分阶段落地过程通过 Git history 追溯；本文是当前唯一维护规范。

## 职责边界

Workspace Mutation Bus 负责：

- workspace node 结构变更：创建、重命名、同项目移动、跨项目转移、删除；
- Markdown 文档 pending revision 或正式 version 变化；
- 插件文档正式 version 变化，如 Slides / MindMap / Sheet；
- 当前打开文档 surface 的刷新触发。

Workspace Mutation Bus 不负责：

- conversation SSE、`tool_output`、`subrun_trace` 的 agent 运行协议；
- Sheet ops 的实时同步主链，Sheet ops 继续走 `sheet-ops-appended`；
- MindMap `attach_evidence` 的证据卫星表版本化，它由证据增量刷新 handler 处理；
- 具体文档如何重新加载或恢复视图，bus 只替换触发，不替换各 domain 的执行层。

## 文件地图

```text
packages/schemas/src/
└─ workspace-mutation-events.ts          # 前后端共享事件契约

src/features/workspace/
├─ definitions/workspaceMutationPublisher.ts
├─ node-transfer/orchestration/transferWorkspaceNode.ts
├─ functions/createWorkspaceNodeMutationEvent.ts
├─ functions/createWorkspaceDocumentMutationEvent.ts
└─ orchestration/workspaceMutationPublisherRegistry.ts

src/electron-main/
├─ services/workspace/workspace.ts       # node.* 发布收口
└─ preload/modules/workspace-preload.ts  # onWorkspaceMutation preload API

apps/renderer/shared/
├─ ipc/workspaceMutationSubscription.ts
└─ ports/workspaceMutationEffectsPort.ts

apps/renderer/app/layout/
├─ composables/useWorkspaceMutationSubscription.ts
└─ orchestration/
   ├─ resolveCurrentOpenDocument.ts
   └─ workspaceMutationEffects.ts

packages/plugin-host-contract/renderer/
└─ documentMutationPort.ts               # 插件 renderer 文档刷新端口

src/plugin-sdk/
├─ backend/workspaceRuntime.ts           # 插件后端发布门面
└─ renderer/documentMutationPort.ts      # 插件 renderer handler 注册实现
```

## 事件契约

事件定义在 `packages/schemas/src/workspace-mutation-events.ts`，通过 zod discriminated union 校验。

当前事件类型：

| 事件 | 语义 | 主要消费者 |
|---|---|---|
| `workspace.node.created` | 新建 workspace node | 文件树刷新、New 标记 |
| `workspace.node.renamed` | node 改名 | 文件树局部刷新 |
| `workspace.node.moved` | node 移动 | 文件树 old/new parent 刷新 |
| `workspace.node.transferred` | node 或完整文件夹子树跨项目转移，携带来源/目标 project 与 `movedNodeIds` | 来源项目移除与 page 继任、目标项目根刷新 |
| `workspace.node.deleted` | node 子树软删，携带 `deletedNodeIds` | 文件树刷新、active page 继任或文件空态 |
| `workspace.document.updated` | 文档内容变化 | Markdown pending、插件 surface |
| `workspace.resourceLibrary.changed` | 项目资源库变化 | 资源库刷新 |

公共规则：

- `mutationId` 必填，用于前端去重；
- 单项目事件使用 `projectId` 过滤当前 workspace scope；跨项目 `node.transferred` 不设置含义模糊的 `projectId`，显式携带 `sourceProjectId` 与 `targetProjectId`；
- `source` 只用于日志观察，不能作为业务分支依据；
- `document.updated.mutationKind` 为 `version | pending | incremental`，表达真实写入语义差异。

`mutationKind` 约定：

- `version`：正式版本变化，可触发当前文档 reload；
- `pending`：Markdown pending revision 变化，只在当前打开文档匹配时应用 pending 投影；
- `incremental`：保留给增量语义，Sheet ops 主链当前不通过它刷新。

## 后端发布规则

发布事件必须靠近真实写入层，不从 agent 或工具输出层猜测。

Agent Flow 通过 `AgentRunnerRuntimePort.workspaceMutationPublisher` 显式接收发布端口；Desktop composition 将 `BackendRendererIntegrationPort.publishWorkspaceMutation` 注入该端口。Flow 不得在执行中查询进程全局 registry，否则测试宿主、App Server 和 Electron Main 会因初始化方式不同而产生隐藏分支。

IPC 与插件后端的历史入口目前仍由 `workspaceMutationPublisherRegistry` 在 App composition 启动时安装同一发布端口。这个 registry 只解决尚未参数化的入口装配，不是新业务代码的默认依赖方式；新增 orchestration 必须优先显式注入 `WorkspaceMutationPublisher`。

### Node 结构事件

`WorkspaceService` 的节点结构方法是 node 事件收口点：

- `createNode`
- `renameNode`
- `moveNode`
- `deleteNode`

这些事件使用事务后发布模式：

1. 写入方法记录待发布事实；
2. `setTimeout(0)` 延迟到同步事务结束后执行；
3. 重查数据库确认最终事实仍成立；
4. 成立才发布，回滚或状态不匹配则不发布。

不要在外层编排重复发布 node 事件。插件后端需要创建 workspace node 时，必须通过 `@plugin/backend/workspaceRuntime` 的 `createWorkspaceService(db)` 门面拿到已注入 publisher 的 `WorkspaceService`。

跨项目转移是独立的 `node-transfer` feature，不伪装成两个 `node.moved`：

1. `inspectWorkspaceNodeTransfer` 只提供 Renderer 保存编排所需的来源事实和完整活动子树 ID；
2. `transferWorkspaceNode` 在 immediate transaction 内重复项目、同名和子树一致性校验；
3. 根节点 `parent_id` 置空，整棵子树原子更新 `project_id`，稳定 node id 不变；
4. 同一事务内清理来源项目的 VFS search index 旧 inode/path 投影；
5. 提交后重查根节点已属于目标根目录，再发布一个 `workspace.node.transferred`。

预检不是授权令牌，不能省略写入事务中的重复校验。外层 IPC、菜单或 app workflow 都不得另发 transfer 事件。

### Markdown 内容事件

Markdown 的写入入口分散，按调用点发布：

- 编辑器保存或 accept pending 产生正式版本时发 `document.updated(version)`；
- `write_file` / `edit_file` 写 pending revision 时发 `document.updated(pending)`；
- renderer 自发起的 set/clear pending 不发事件，避免回声刷新。

Markdown 规范化写入当前没有 UI 消费者，暂不发布事件。

### 插件文档事件

插件文档必须在各自 persistence 层发布 `document.updated(version)`，而不是在 hook decorator 或工具层发布。

当前收口点：

- Slides：`PresentationRepository.createPresentation/saveVersion`
- MindMap：`MindMapDocumentService.createDocument/updateDocument`
- Sheet：`SheetDocumentService.saveCheckpoint`

插件 persistence 同样使用 `setTimeout(0)` + 重查版本存在性，避免外层事务回滚后发布假事件。

### 资源库事件

项目资源库写入收口在 `registerGeneratedImagesAsProjectAssets`。成功登记资产后发布 `workspace.resourceLibrary.changed`，payload 使用实际登记成功的 `assetIds`。

## 传输链路

后端广播实现：

- `createWorkspaceMutationPublisher()`
- `installWorkspaceMutationPublisher(publish)`

发布前会用 `parseWorkspaceMutationEvent` 校验 payload。Backend 只调用已安装的 publisher；当前 Electron adapter 再通过 `BrowserWindow.getAllWindows()` fanout 到 `workspace:mutation` channel，迁入 App Server 后同一 data-only event 通过 reverse desktop capability 投影，业务写入层不接触 Electron。

preload 暴露：

- `window.electronAPI.workspace.onWorkspaceMutation(callback)`

renderer 订阅：

- `subscribeToWorkspaceMutation(callback)`
- `useWorkspaceMutationSubscription()`

这条 channel 是 app 级 workspace 产品事件，不复用 conversation SSE，也不进入 linnkit runtime event / context manager。

## 前端消费规则

前端统一入口是 `apps/renderer/app/layout/orchestration/workspaceMutationEffects.ts`。

它只做四件事：

1. 按 `projectId` 过滤当前项目；
2. 按 `mutationId` 去重；
3. 将 node/resource/markdown 事件分发到 workspace 或 editor 既有 action；
4. 将插件文档 version 事件派发给 renderer document mutation handlers。

具体行为：

- `node.created`：`markNodeAsNew`，有 parent 时刷新 parent children，否则刷新项目树；
- `node.renamed`：刷新 parent 或项目树；
- `node.moved`：调用 `refreshAfterMove(oldParentId, parentId)`；
- `node.transferred`：当前 scope 为来源项目时按完整 `movedNodeIds` 关闭失效 runtime、刷新来源 parent 并选择相邻 page；当前 scope 为目标项目时刷新根目录；本窗口已经同步处理的事件只去重，不再重复加载；
- `node.deleted`：根据 `deletedNodeIds` 判断 active page 是否被删除，停用旧 runtime、刷新 parent 或项目树，再选择相邻 page；没有 page 时由原文档 pane 展示“暂无文件”，不能关闭或替换另一侧对话；
- `resourceLibrary.changed`：刷新当前项目资源库；
- Markdown `document.updated(pending)`：当前打开 Markdown 匹配时调用 pending revision 刷新；
- Markdown `document.updated(version)`：当前无 UI 动作；
- 插件 `document.updated(version)`：当前打开文档匹配时派发给插件 handler。

当前打开文档的权威来源是 `layoutStore.state.activeDocument`，通过 document type registry 映射到 workspace `nodeType`。不要用 file-manager session 判断 Slides 等插件文档是否当前打开，因为不是所有 surface 都有 file-handler。

## 插件接入规则

插件接入分后端和前端两半。

后端 persistence：

- 在正式版本写入处发布 `document.updated(version)`；
- 通过 `@plugin/backend/workspaceRuntime` 的 `publishWorkspaceDocumentUpdated` 或注入的 publisher port 发布；
- 必须在事务后重查，禁止在未提交事务内直接广播。

前端 renderer：

- 在 `register*RendererPorts.ts` 注册 `registerRendererDocumentMutationHandler`；
- handler 只处理自己 `nodeType` 和 `activeDocumentType` 匹配的当前文档；
- handler 内复用本插件已有执行层，不把刷新逻辑写回 host。

当前插件策略：

| 插件 | Bus handler 行为 | 保留的非 bus 刷新 |
|---|---|---|
| Slides | `refreshDeck(documentId)` | 无 |
| MindMap | `requestRefresh({ reason: 'push:document_updated' })` | `attach_evidence` 证据 count/list 增量刷新 |
| Sheet | 非 dirty 时 `reloadRemoteSnapshot()` | ops 补拉与 `sheet-ops-appended` |

## 开发规范

新增 workspace/document 写路径时，按这个顺序判断：

1. 是否创建、删除、移动、重命名 workspace node？
   - 必须走已注入 publisher 的 `WorkspaceService`。
2. 是否把 node 转移到另一个项目？
   - 必须走 `node-transfer` feature；不得直接更新 `project_id`，也不得复制后删除。
3. 是否写入 Markdown pending 或正式 version？
   - 在 Markdown 调用点发布 `document.updated(pending/version)`。
4. 是否写入插件文档正式 version？
   - 在插件 persistence 层发布 `document.updated(version)`。
5. 是否只是插件内部增量状态？
   - 优先使用该插件自己的增量机制，不要塞进 workspace bus。
6. 是否只是 conversation / agent 可观察事件？
   - 不属于 workspace mutation bus。

禁止事项：

- 禁止从 `tool_output` / `subrun_trace` 解析 workspace 刷新事实；
- 禁止按 `source` 做业务分支；
- 禁止在插件工具层和 persistence 层双发同一个版本事件；
- 禁止绕开 `createWorkspaceService(db)` 直接 `new WorkspaceService(db)` 用于生产写路径；
- 禁止让 host 直接 import 插件内部 store 来刷新插件 surface。
- 禁止在拖拽或菜单成功回调中重复刷新树；提交后的结构投影统一由 mutation bus 驱动。

## 测试入口

常用验证：

```bash
npm run test -- src/electron-main/services/workspace/__tests__/workspace-mutation-events.test.ts
npm run test -- src/features/workspace/document-lifecycle/__tests__/workspaceDocumentLifecycle.test.ts
npm run test -- apps/renderer/app/layout/orchestration/workspaceMutationEffects.test.ts
npm run test -- src/plugin-sdk/renderer/rendererPorts.test.ts
```

插件 persistence / renderer 相关测试：

```bash
pnpm test -- packages/plugins/slides/src/backend/persistence/presentation-repository.test.ts
pnpm test -- packages/plugins/mindmap/src/backend/persistence/mindmap_document/services/mindmap_document.service.test.ts
pnpm test -- packages/plugins/__tests__/rendererPluginBoundary.test.ts apps/renderer/app/plugins/loader/rendererHostExternalBoundary.test.ts
```

构建验证：

```bash
npm run build:backend
pnpm run build:frontend
npm run build:plugin:slides
npm run build:plugin:mindmap
npm run build:plugin:sheet
pnpm run guard:tsc-baseline
```

## 排查清单

侧边栏不刷新：

- 写路径是否走了已注入 publisher 的 `WorkspaceService`？
- 是否在事务回滚或状态不匹配后被重查过滤？
- `projectId` 是否匹配当前 `workspaceScopeStore.currentProjectId`？

当前插件文档不刷新：

- persistence 是否发布 `document.updated(version)`？
- `nodeType` 是否和插件 document type 注册一致？
- `resolveCurrentOpenDocument()` 是否能从 `layoutStore.activeDocument` 解析当前文档？
- 插件是否注册了 renderer document mutation handler？

Markdown pending 不显示：

- 写路径发的是 `mutationKind: 'pending'` 吗？
- 当前打开文档 id 是否等于事件 `documentId`？
- `applyPendingRevisionsToOpenMarkdownDocument` 是否能读到 pending revision？

Sheet 被远端覆盖：

- `registerSheetRendererPorts.ts` 的 dirty 门禁应阻止 dirty workbook 全量 reload；
- ops 级同步应优先检查 `sheet-ops-appended` 和 `pullRemoteOps()`，不要直接归因到 workspace bus。
