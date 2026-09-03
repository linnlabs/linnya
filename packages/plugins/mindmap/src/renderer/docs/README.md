## MindMap README（导航索引 / 目录树 / 关键入口）

> 中文说明：
> - 这是 `packages/plugins/mindmap/src/renderer/` 的总 README，用作“AI / 新同学 / 评审者”的导航地图。
> - 风格对齐仓库其它模块 README：**目录树 + 关键文件索引 + 约束与边界**。
>
> 最后更新：2026-06-04

---

## 1) 阅读顺序（建议）

- **开发规范（硬规则 + 为什么）**：`docs/MINDMAP_DEV_GUIDE.md`
- **本 README**：目录树 + 关键入口索引
- **未来规划（自由画布/白板方向）**：`docs/FUTURE_PLAN.md`

---

## 1.1) 插件边界（2026-06-04）

MindMap domain 现在是内置 `mindmap` 插件的业务实现，不再由 `platform` 插件直接注册，也不再通过 host renderer 专属 glue 静态注册。

- 渲染端贡献入口：`packages/plugins/mindmap/src/renderer/index.ts`
  - 负责贡献 Mindmap documentType、surface、file handler、图标和工具卡；host 通过 `plugins:renderer-entries` 按 manifest/启用态动态加载。
- 后端贡献入口：`src/app-hosts/linnya/plugin-registry/builtin/mindmap.backend.ts`
  - 负责贡献 Mindmap 专属 tool、agent 和 `mindmap_editor` subagent type。
- 能力门禁入口：`src/app-hosts/linnya/plugin-registry/mindmapPluginAccess.ts`
  - 只判断 runtime enabled snapshot，不读 DB，不负责 UI 过滤；VFS 通过通用的 `pluginWorkspaceVfsNodeTypeAccessPolicy`（`plugin-registry/pluginWorkspaceVfsNodeTypeAccessPolicy.ts`）控制内容读取。

约束：

- `platform` 不应直接 import 本 domain 来注册 Mindmap surface、handler 或 toolCards；需要新增入口时，应先判断它属于 `mindmap` 插件贡献、platform 依赖，还是后续通用插件契约。
- 本 domain 内的副作用必须绑定到 MindMap surface 生命周期并可 dispose；禁止在模块 import 期注册全局监听、刷新器或 store 副作用，否则禁用插件后会出现“入口隐藏但副作用仍运行”的假禁用。
- 禁用 Mindmap 不删除用户数据。已有 `.mindmap` 文件可以保持文件名可见，但内容读取、写入、编辑、IPC 写入和模型可见能力必须通过插件启用状态门禁。

Sheet / Slides 后续插件化可复用这条路径：先拆 backend/renderer contribution，再治理通用工具旁路和 IPC/VFS 门禁；区别是 Sheet engine 与 Slides codegen 各自有更重的运行时生命周期，建议另开专题处理。

---

## 2) 模块目录树（高信号导航）

> 说明：这棵树不追求 100% 穷举，但**关键模块与大多数重要文件都会列出**。

```text
packages/plugins/mindmap/src/renderer/
├─ index.ts                                   # MindMap 入口导出
├─ ui/
│  └─ MindMapView.vue                          # 思维导图页面/容器（集成入口之一）
├─ docs/
│  ├─ README.md                                # 本文件（导航索引）
│  ├─ FUTURE_PLAN.md                           # 自由画布/白板方向（非过程性子计划）
│  └─ MINDMAP_DEV_GUIDE.md                      # ✅ 开发规范（contracts + 基础设施升级结论合并）
├─ domain/                                     # 业务数据层（ownership：状态变更）
│  ├─ core/
│  │  ├─ methods.ts                            # MindMap 实例方法集合（init/destroy 等）
│  │  └─ hooks.ts                              # before hooks（feature 扩展点）
│  ├─ types/
│  │  ├─ index.ts                              # MindMapInstance / Options / 数据结构
│  │  ├─ dom.ts                                # DOM 相关类型
│  │  └─ global.ts                             # 全局类型
│  ├─ constants/
│  │  └─ index.ts                              # 常量（方向等）
│  ├─ store/
│  │  └─ mindmapStore.ts                       # MindMap 领域 store（viewport 缓存 + 启动后首次进入首屏策略）
│  ├─ operations/                              # operations ownership：只能这里 fire operation
│  │  ├─ nodeOperations.ts                     # 节点 CRUD / move / expand 等核心操作
│  │  ├─ operationHistory.ts                   # undo/redo（快照栈）
│  │  ├─ selectionRestore.ts                   # ✅ selection 恢复（语义化 + 可观测）
│  │  └─ undo-redo.readme.md                   # 撤销/恢复说明（模块内 README）
│  ├─ commands/                                # ✅ 唯一副作用入口（mind.commands / mind.can）
│  │  ├─ registry.ts                           # 安装入口：注入 commands/can/runCommand + meta/txId
│  │  ├─ types.ts                              # Command 类型（source/meta/result）
│  │  ├─ guards.ts                             # can/guards（纯检查）
│  │  ├─ normalize.ts                          # 口径归一化（root 过滤/去重/父子收敛）
│  │  ├─ internal/
│  │  │  ├─ commandContext.ts                  # active ctx/txIds（嵌套栈）
│  │  │  └─ commandLogger.ts                   # 命令日志（结构化）
│  │  ├─ commands/
│  │  │  ├─ nodeCommands.ts                    # node.* 命令实现
│  │  │  ├─ selectionCommands.ts               # selection.* 命令实现
│  │  │  ├─ reflowCommands.ts                  # reflow.* 命令实现
│  │  │  └─ index.ts
│  │  ├─ index.ts
│  │  └─ commands.readme.md                    # 命令体系 README（模块内）
│  └─ transaction/                             # ✅ tx 观测聚合：TxRecorder + Steps + Mapping
│     ├─ types.ts
│     ├─ txRecorder.ts
│     ├─ stepRecorder.ts
│     ├─ index.ts
│     └─ transaction.readme.md                 # transaction README（模块内）
├─ interaction/                                # 交互层（RawEvent → Intent → Command/ui:*）
│  ├─ mouseHandlers.ts                         # 事件绑定入口（轻量路由）
│  ├─ handlers/                                # 按事件拆分 handler
│  │  ├─ click.ts
│  │  ├─ dblclick.ts
│  │  ├─ wheel.ts
│  │  ├─ pointerPan.ts
│  │  ├─ contextmenu.ts
│  │  └─ keyboard.ts                           # 空格态等交互状态（不是业务快捷键）
│  ├─ intents/                                 # intent 体系（可序列化 payload，禁止 DOM 泄漏）
│  │  ├─ types.ts
│  │  ├─ intentRouter.ts
│  │  ├─ intentDispatcher.ts                   # MindMap Intent 派发器
│  │  ├─ intentLogger.ts
│  │  └─ index.ts
│  ├─ keyboard/                                # KeymapRegistry（键盘治理）
│  │  ├─ KeymapRegistry.ts
│  │  ├─ keybinding.ts
│  │  ├─ defaultKeymap.ts
│  │  ├─ installMindMapKeymap.ts
│  │  └─ index.ts
│  ├─ selection/                               # selection 引擎（独立子系统）
│  │  ├─ README.md
│  │  ├─ core/
│  │  │  ├─ SelectionEngine.ts
│  │  │  ├─ InputObserver.ts
│  │  │  ├─ SelectionStrategy.ts
│  │  │  ├─ SelectionRenderer.ts
│  │  │  ├─ SelectionStoreManager.ts
│  │  │  ├─ ScrollHandler.ts
│  │  │  ├─ EventEmitter.ts
│  │  │  ├─ index.ts
│  │  │  └─ types.ts
│  │  ├─ adapters/MindMapSelectionAdapter.ts
│  │  ├─ actions/nodeActions.ts
│  │  ├─ utils/
│  │  │  ├─ events.ts
│  │  │  ├─ helpers.ts
│  │  │  └─ index.ts
│  │  └─ index.ts
│  ├─ nodeDraggable.ts                          # 节点拖拽（dragend 提交命令）
│  ├─ nodeExpansion.ts                          # 展开/折叠（含强时序补偿点）
│  ├─ viewControls.ts                           # 视图控制（缩放/平移）
│  ├─ dataControls.ts                           # 数据导出/refresh/方向等
│  ├─ index.ts
│  └─ interaction.readme.md                     # interaction README（模块内）
├─ presentation/                                # DOM 渲染 + Vue UI
│  ├─ engine/
│  │  ├─ MindMapEngine.ts
│  │  ├─ dom.ts
│  │  └─ plugins.ts
│  ├─ render/
│  │  ├─ links.ts
│  │  ├─ arrow.ts
│  │  └─ summary.ts
│  ├─ ui/
│  │  ├─ MindMapToolbar.vue
│  │  ├─ MindMapContextMenu.vue
│  │  ├─ contextMenu/
│  │  │  ├─ mindmapAiRun.ts                    # ✅ 右键 AI：发起历史隔离 run（隐藏 nodeId 等内部字段）
│  │  │  ├─ menuItems.ts                       # ✅ 菜单项构建（纯函数）：AI 入口 + 打标子菜单
│  │  │  └─ types.ts                           # 右键菜单 MenuAction/MenuItem 类型
│  │  ├─ NodeEditor.vue
│  │  ├─ RichContentHost.vue
│  │  └─ NodeAddonsHost.vue
│  ├─ addons/
│  │  ├─ nodeAddonsRegistry.ts
│  │  └─ nodeaddons.readme.md
│  ├─ composables/useMindmapHotkeys.ts
│  └─ styles/
│     ├─ mindmap.css
│     └─ markdown.css
├─ features/
│  ├─ shared/installFeatureLifecycle.ts
│  └─ evidence/                                 # 引用 feature
│     ├─ README.md
│     ├─ services/installEvidenceFeature.ts
│     ├─ domain/
│     │  ├─ store/
│     │  │  ├─ evidenceStore.ts
│     │  │  └─ referenceInsertStore.ts
│     │  └─ sync/evidenceSyncPlugin.ts
│     └─ ui/
│        ├─ ReferenceAddon.vue
│        ├─ ReferenceInsertPanel.vue
│        ├─ components/
│        │  ├─ ReferenceKbTab.vue
│        │  └─ ReferenceWebManualTab.vue
│        └─ index.ts
│  ├─ tagging/                                  # ✅ 打标呈现 feature（status/confidence/解释入口）
│  │  ├─ README.md
│  │  ├─ services/installTaggingFeature.ts
│  │  ├─ domain/store/taggingStore.ts
│  │  └─ ui/TaggingBadgeAddon.vue
│  └─ autoRefresh/                              # ✅ 自动刷新编排 feature（工具结果驱动）
│     ├─ README.md
│     ├─ domain/types.ts
│     └─ services/
│        ├─ installAutoRefreshFeature.ts
│        ├─ mindMapEvidenceRefreshTrigger.ts
│        ├─ mindMapAutoRefreshService.ts
│        ├─ mindMapRefreshGate.ts
│        └─ mindMapRefreshSnapshot.ts            # viewport/selection/focusMode 快照与恢复
├─ shared/
│  ├─ utils/
│  │  ├─ reflow/ReflowScheduler.ts
│  │  ├─ reflow/reflowscheduler.readme.md
│  │  ├─ interactionGate/InteractionGate.ts
│  │  ├─ interactionGate/interactiongate.readme.md
│  │  ├─ events/eventBus.ts
│  │  ├─ events/lifecycleSignals.ts
│  │  ├─ dom/index.ts
│  │  ├─ dom/nodeId.ts
│  │  ├─ layout/generateBranch.ts
│  │  ├─ svg/pathGenerator.ts
│  │  └─ tree/nodeTreeOperations.ts
│  ├─ hotkeys/defaultHotkeys.ts                 # legacy hotkeys 表（逐步下线）
│  └─ plugin/keypress.ts                        # legacy keydown 插件（逐步下线）
├─ __tests__/
│  ├─ MindMap.spec.ts
│  ├─ operations.spec.ts
│  ├─ commands.removeSelected.spec.ts
│  ├─ batchDelete.spec.ts
│  ├─ interaction.intentKeymap.spec.ts
│  ├─ phase3.regression.spec.ts
│  ├─ selection.restore.spec.ts
│  ├─ selectionUtils.spec.ts
│  └─ benchmarks/
│     ├─ datasetGenerator.ts
│     ├─ benchmarkScenarios.ts
│     ├─ historyBenchmark.ts
│     └─ index.ts
└─ types/dom.ts
```

---

## 3) 开发红线（最重要的“不要做”）

- **入口收敛**：副作用只允许从 `mind.commands.*` 进入；不要在 UI/feature/handler 里直连 operations
  - 参见：`domain/commands/commands.readme.md`
- **Reflow 统一**：UI/feature 禁止 `mind.linkDiv()` / `mind.layout()`；只能 `mind.requestReflow(reason)`
  - 参见：`shared/utils/reflow/reflowscheduler.readme.md`
- **payload 禁止 DOM 泄漏**：跨层只传 `nodeId/nodeIds`，禁止携带 `Topic/HTMLElement/domId/Event`
  - 参见：`docs/MINDMAP_DEV_GUIDE.md`
- **键盘治理**：禁止 feature 私自 `addEventListener('keydown')` 接管业务快捷键（统一走 KeymapRegistry）
  - 参见：`interaction/interaction.readme.md`

---

## 3.1 首屏视口策略与“防闪烁”机制（重要）

### 3.1.1 视口（viewport）恢复规则

- **启动后第一次进入 MindMap 页面（reason=open）**：
  - 体验目标：聚焦根节点居中；若图较大则智能缩小（避免首屏看不到全图）。
  - 实现位置：`domain/store/mindmapStore.ts`
- **启动后再次进入 / 切换文档（reason=reload/switch）**：
  - 体验目标：回到上次停留位置（同一启动周期内优先内存缓存，其次 metadata）。
  - 实现位置：`domain/store/mindmapStore.ts`（`viewportCacheByDocumentId` + `documentMetadata.viewport`）

### 3.1.2 为什么“有引用的图”更容易闪？

中文说明（根因）：
- Evidence 引用区是否渲染依赖异步 counts（`mindMapEvidenceGateway.count`）；
- counts 未就绪时，节点 addons 可能不出现；counts 到达后 addons 突然出现，会改变节点高度/宽度并触发 reflow；
- 若画布在“结构重建 / viewport 写入 / addons 渲染”过程中被显示，用户会看到短暂的中间态（视觉闪一下）。

### 3.1.3 readiness 门禁 + 锚点视口（显示时机收敛 + 抗漂移）

- **Store 状态**：`isMindMapReady`
  - `false`：隐藏画布（避免露出 init/refresh 的中间态）
  - `true`：显示画布（至少已完成一次“首屏/恢复”视口策略写入）

- **锚点视口（root-anchored viewport）**：
  - **核心思想**：把用户看到的位置表达为 `rootCentered(dx,dy) + offset(x,y)`，而不是只记绝对 `translate(x,y)`
  - **收益**：当 addon/字体/CSS 导致 layout 变化（root 的 offsetLeft/width 改变）时，在 `lifecycle:geometryFlushed` 后重新计算 \(dx,dy\)，避免“回到中心后 reload 往右偏”“大图更明显”的漂移
  - **实现位置**：`domain/store/mindmapStore.ts`（`viewportAnchorByDocumentId` + `computeCenterDefault()` + geometryFlushed 重基准监听）

- **首屏策略时序（提速 + 智能缩放）**：
  - **触发条件**：
    - 场景 1: App 启动后打开的第一个文档（`reason=open`）
    - 场景 2: 切换文档（`reason=switch`），且该文档在**本端内存中无缓存**，并且 metadata 中的 viewport 为默认值（或空）
  - **执行动作**：
    - 在下一帧直接执行 `scaleFit()+toCenter()` 并显示（不再强制等待 evidence counts）
    - **Addon 布局监听**：开启一个临时的 `lifecycle:geometryFlushed` 监听器（2秒超时），专门捕获由 `addons:content` 引起的布局变化
    - **自动修正**：当检测到 Addon 加载导致布局撑开时，自动重新执行 `scaleFit()+toCenter()`，确保视图再次聚焦到根节点并适应屏幕（解决“先点小图再点大图”时的漂移问题）
  - 若后续 counts 到达导致 addons 变化，依赖“锚点视口重基准”保持视觉位置稳定

### 3.1.4 点击引用时为什么 MindMap 会“闪一下”（同文档重复 open）

中文说明（根因）：
- 对话渲染与工具卡片里会把 `[#ref]` 渲染为可点击的链接（`a.ai-ref-link`），点击后会走“打开文档会话 + 定位到段落/节点”的链路；
- 这条链路历史上直接调用 `activateFileSession()`；
- **但 `activateFileSession()` 即使激活的是同一个 `documentId` 也会继续执行 handler.open()**；
- 对 MindMap 来说，`open()` 通常意味着全量重载与 readiness gate（`isMindMapReady=false→true`）的隐藏/显示流程，因此会出现“闪一下”的不合理体感。

修复策略（硬规则）：
- 当目标会话已经是当前 `activeSession`（同 `type + documentId`）时，**只切视图/只做定位，不重复 open()**。

实现位置（参考）：
- `apps/renderer/domains/conversation/ui/message/components/markstream/ConversationReferenceNode.vue`
- `apps/renderer/domains/conversation/ui/tools/shared/WorkspaceRefLink.vue`
- `apps/renderer/domains/workspace/services/file-manager/index.ts`（`getActiveFileSession()`）

---

## 3.2 闪烁问题排查（调试日志开关）

> 中文说明：当你遇到“Enter 新建兄弟节点会闪一下 / 视口抖动 / 连线补一拍”等问题时，
> 请先开启这个日志开关，把一次操作的完整日志贴出来（不要猜）。

- **开启**：`globalThis.__setMindMapFlickerDebug(true)`（或 `globalThis.__MM_FLICKER_DEBUG__ = true`）
- **关闭**：`globalThis.__setMindMapFlickerDebug(false)`（或 `globalThis.__MM_FLICKER_DEBUG__ = false`）

日志前缀：`[MindMapFlicker]`

实现位置：`shared/utils/debug/flickerDebug.ts`

---

## 4) 关键子系统 README（模块内入口）

- **Commands**：`domain/commands/commands.readme.md`
- **Interaction**：`interaction/interaction.readme.md`
- **Undo/Redo**：`domain/operations/undo-redo.readme.md`
- **Transaction**：`domain/transaction/transaction.readme.md`
- **Evidence feature**：`features/evidence/README.md`
- **Tagging feature**：`features/tagging/README.md`
- **AutoRefresh feature**：`features/autoRefresh/README.md`
- **Node Addons**：`presentation/addons/nodeaddons.readme.md`
- **ReflowScheduler**：`shared/utils/reflow/reflowscheduler.readme.md`
- **InteractionGate**：`shared/utils/interactionGate/interactiongate.readme.md`

---

## 5) AI 能力指南（MindMap Reasoning Canvas）

### 5.1 数据契约（Spine + Satellite）

- **Spine（版本化）**：`mindmap_versions.content_json`（`MindMapData` / `NodeObj`）
  - **打标字段**：`NodeObj.tagging?: NodeTagging`
    - `tagging.status?: string`（推荐：`open/verified/refuted/closed`，允许扩展）
    - `tagging.confidence?: string | number`（推荐：`high/medium/low`，允许扩展）
    - `tagging.labels?: Record<string, string | number | boolean>`
      - `tagging.labels.kind`：节点语义类型（推荐：`hypothesis/question/conclusion`，支持手动打标 + 工具写入）
- **Satellite（非版本化）**：`mindmap_evidence`（证据链，按 nodeId 关联）

### 5.2 后端工具（Workspace Tools）

> 工具执行在后端（workspace db），返回 `StructuredToolResult { data, observation }`（JSON 字符串）。

- **读结构（NodeRef View）**：`read_file`（`view="document"`）
  - 对 mindmap 输出“缩进大纲 + `[#ref]` 行协议”
  - **补充**：节点行尾会在存在时追加 `⟦status=... conf=... kind=...⟧`（便于 Agent 读到打标结果）
- **打标（写新版本）**：`mindmap_tag_node`
  - 写入 `node.tagging.status/confidence/labels`
  - 工具会自动读取最新版本并在保存时做 CAS（乐观锁）
- **挂证据（写卫星表）**：`mindmap_attach_evidence`
  - 写入 `mindmap_evidence`，不修改 `mindmap_versions`，因此不需要版本锁

源码位置：
- `packages/plugins/mindmap/src/backend/tools/mindmap/MindMapTagNodeTool.ts`
- `packages/plugins/mindmap/src/backend/tools/mindmap/MindMapAttachEvidenceTool.ts`

### 5.3 前端呈现与闭环（Tagging / Evidence / AutoRefresh）

- **Evidence feature**：`features/evidence/README.md`
  - 证据展示与插入面板，提供事件入口：`ui:toggleReferenceInNode`
- **Tagging feature**：`features/tagging/README.md`
  - 基于 `NodeObj.tagging` 在节点 addons 的“元信息栏”统一呈现：节点类型（kind）/状态/置信度 + Refuted 解释入口（点击展开证据列表）
  - 将 `status/confidence` 注入 `mm-node[data-tagging-status/data-tagging-confidence]` 供 CSS 使用
- **AutoRefresh feature**：`features/autoRefresh/README.md`
  - 工具结果驱动刷新（合并/防抖 + 交互门禁 + 等待 structureReady + viewport/selection/focusMode 快照恢复）

### 5.4 引用/证据策略（重要约束）

- **MindMap 不把 `[@ref]` 写进节点 topic** 作为引用存储方式
  - **原因**：topic 是核心可编辑文本；混入引用 token 会影响可读性与编辑体验，也不利于未来 addon 多样化
- **证据必须落在 Satellite（`mindmap_evidence`）**：独立 CRUD、不触发版本变更
  - 详情见：`features/evidence/README.md`
- **工具侧（已实现）**：`mindmap_attach_evidence` 仅接受知识库 `[@ref]` 引用
  - 模型输出 `node_ref`（节点短引用）+ `refs`（知识库 `[@XXXXXX]` 列表），禁止自写 snippet/title
  - 工具端通过 Citation source runtime 获取 Host 已接纳来源，只接受其中的 Knowledge `(docId, blockId)` 身份
  - 从知识库 SoT 确定性回填 `snippet`、`title`、`sourceId=docId#blockId`
  - 写入 `mindmap_evidence` 时 `sourceType` 固定为 `knowledge_base`
  - refs 必须来自之前 `knowledge_search` / `knowledge_read` 等工具的输出（不允许编造）

### 5.5 pageContext 注入与工具集切换（Milestone 4 落点）

- **pageContext 构建**：`apps/renderer/domains/conversation/services/orchestration/context/pageContext.ts`
- **Agent 选择与 pageContext 分离**：普通会话从 `Conversation.selectedAgentId` 上行 `selected_agent_id`，由 Host admission 按正式 Agent 身份解析内部执行键
  - MindMap 页面类型只提供 `pageContext`，不会自动切换 Agent 或 `promptKey`；未显式选择 Agent 时走 Host 默认 Agent
  - MindMap 自有的 application use case / one-shot 调用若需要内部 `promptKey`，由对应 orchestration 明确持有，不写入 Conversation metadata
- **编排器注入点**：`apps/renderer/domains/conversation/services/orchestration/chatFlowOrchestrator.ts`
  - 注入 pageContext 到 `contextBefore`
  - MindMap 场景无 editor 时，使用 sidebar context 构建 documentFragment

### 5.6 工程建议：什么时候抽到 `packages/`

当出现以下任一需求时，建议把“MindMap 数据变换核（纯 TS）”抽到 `packages/`，避免前后端实现漂移：
- 后端工具需要复用 renderer 的树操作（move/reorder/批量新增）
- 需要系统化 `ChangeSet` 与单测覆盖
- 需要与前端一致的 tidy/校验口径（arrows/summaries）

相关设计文档（未落地，作为架构备选）：
- `docs/MODEL_纯TS模型方案.md`

### 5.7 已知限制与后续方向（给工程实现定边界）

- **Undo/Redo 语义**：
  - 当前主线是“后端写新版本 + 前端自动刷新”，它**不会自然进入** MindMap 的 `operation` → undo/redo 链路
  - 若未来希望 AI 变更可撤销：可评估“前端 commands 执行路径”（让变更进入 operations），或引入“版本切换的可观测操作”作为单独能力
- **并发治理**：
  - 写入新版本使用 CAS（乐观锁）避免并发覆盖：工具会自动读取“基线版本号”并在保存时校验；若并发写入导致版本不一致，会拒绝写入并提示重试
  - 刷新必须经过交互门禁（输入/拖拽/框选/pan 时延迟），避免打断用户

### 5.8 右键菜单：AI 运行入口（拆解问题 / 验证假设 / 提出假设）

> 中文说明：右键菜单已接入 AI 运行链路，并按“用户可读文案 + 隐藏结构化上下文”的方式传递 nodeId 等定位信息（避免把内部字段暴露在用户气泡里）。

- **实现位置**：
  - `presentation/ui/MindMapContextMenu.vue`：UI 事件绑定 + action 分发（不承载编排细节）
  - `presentation/ui/contextMenu/mindmapAiRun.ts`：发起历史隔离 AI run（document_fragment + context_before）
  - `presentation/ui/contextMenu/menuItems.ts`：菜单项构建（AI 入口与“推理标签”子菜单）
  - `presentation/ui/contextMenu/types.ts`：菜单类型定义（`MenuAction/MenuItem`）
- **展示规则（按节点 kind）**：
  - **根节点（Root）**：显示“深度分析”（强制工作流：拆解→提假设→验假设；对应 `promptKey=mindmap_workflow_leader`）
  - `question`：显示“拆解问题 / 提出假设”
  - `hypothesis`：显示“验证假设 / 提出假设”
  - `conclusion`：不显示（无效果）
- **当前行为**：
  - 点击会发起一次历史隔离 run，并注入 MindMap NodeRef View 作为文档上下文
  - 用户气泡只展示 `验证假设：<topic>` 这类可读文案；`node_id/document_id/...` 通过 `context_before` 隐式传递给 AI（便于定位节点）

### 5.9 接入 AI 计划（理论方案）：新增两个 MindMap 专用 Agent

> 目标：把右键菜单入口接到“可观测、可回放、可收敛”的 agent 定义上（**不做补丁式接线**）。
>
> ✅ 现状：三个 promptKey（拆解问题/提出假设/验证假设）已落地，对应后端 AgentRegistry 定义已存在（见 `src/features/agent-registry/agents/mindmap/*`）。

#### 5.9.0 先接入历史隔离 Run（不执行，只落库 run 头）

> 中文说明：MindMap 右键属于“外部入口”。最小可用方案是先接入历史隔离 run 的头部落库能力：**不引入历史对话**，把本次请求写进事件库，后续对话/刷新仍可见。
> 参考设计文档：[`docs/conversation-platform/10-subruns.md`](../../../../../../docs/conversation-platform/10-subruns.md)（活动 / subrun 系统规范）。

#### 5.9.1 Agent 拆分（三个 promptKey）

- **Agent A：拆解问题**（`mindmap_decompose_question`）
  - 触发：右键 `question` 节点 → “拆解问题”
  - 预期产物：在该问题节点下新建若干子问题节点（`kind=question`），形成 Issue Tree
  - 约束：不写 `status/confidence`（问题节点不允许打标）
- **Agent B：验证假设**（`mindmap_validate_hypothesis`）
  - 触发：右键 `hypothesis` 节点 → “验证假设”
  - 预期产物：搜索/引用证据 → `mindmap_attach_evidence` 挂证据 → `mindmap_tag_node` 打标（verified/refuted + confidence）
  - （可选）为该假设追加结论子节点（`kind=conclusion`）并设置置信度（结论不允许 status）
- **Agent C：提出假设**（`mindmap_propose_hypothesis`）
  - 触发：右键 `question / hypothesis` 节点 → “提出假设”
  - 预期产物：在该节点下创建若干子假设节点（`kind=hypothesis`）
  - 约束：不写 `status/confidence`，不挂证据

#### 5.9.2 后端落地步骤（AgentRegistry 单一真源）

1) **新增 promptKey**：
   - `src/features/agent-registry/prompt.types.ts`：加入 `mindmap_decompose_question` / `mindmap_validate_hypothesis` / `mindmap_propose_hypothesis`
   - 若需要由前端发起调用：同步在 `packages/schemas/src/agent-config/index.ts` 增加常量（避免字符串散落）
2) **新增 agent 目录**：
   - `src/features/agent-registry/agents/mindmap/decompose_question/{prompt.ts,index.ts}`
   - `src/features/agent-registry/agents/mindmap/validate_hypothesis/{prompt.ts,index.ts}`
   - `src/features/agent-registry/agents/mindmap/propose_hypothesis/{prompt.ts,index.ts}`
3) **工具白名单**（建议与后端 `default` agent 在 MindMap `pageContext` 下的能力口径对齐并按需收缩）：
   - 必需：`read_file`（`view="document"`）、`mindmap_create_node`
   - 验证假设必需：`mindmap_tag_node`、`mindmap_attach_evidence`
   - 可选：`knowledge_search`（用于搜证据）
4) **聚合注册**：通过 Mindmap backend contribution 的 `agentDefinitions` 暴露这些 agent，不再改 host 的全量 agent 快照。
5) **步数收尾策略（如需要）**：
   - 若发现“最后一步来不及落工具”：用 `AgentDefinition.config.stepPolicy` 做 `force_tools` 收敛（参考 `src/features/agent-registry/README.md`）

#### 5.9.3 前端接线步骤（右键 → 发起 agent run）

> 核心原则：右键菜单只负责“意图”，不在 MindMap 域内硬编码对话/执行细节。

- **右键菜单入口**：`presentation/ui/MindMapContextMenu.vue`
  - 点击菜单会发起一次历史隔离 run（run 头 user_input + 持久化落库）
  - 宿主必须通过 `history_mode: 'isolated'` 执行，不读取已有历史；调用方不再手写空历史数组
- **把 nodeId 转换为 NodeRef**：
  - 复用 `packages/plugins/mindmap/src/renderer/utils/mindmapAiContext.ts` 内部使用的 refMap 口径（SHA-256 + Base62），确保 agent/工具可直接用 `[#ref]` 作为锚点
- **上下文构建**：
  - Agent 上下文管理与三阶段填充模型见：`src/features/context-manager/agent/README.md`
  - MindMap 场景的 pageContext 与工具集切换见本章 **5.5**

---

## 6) 工程护栏与测试入口

- **守卫**：`scripts/guards/mindmap-guards.ts`（命令：`pnpm run guard:mindmap`）
- **测试**：`packages/plugins/mindmap/src/renderer/__tests__/*`
