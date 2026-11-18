# 业务验收入口

先按用户行为选择已有入口，再读对应 owner。这里是少量高价值回归的索引，不是另一套测试框架，也不是整包发布认证。命令都在当前 checkout 根目录运行；首轮先按[构建与测试](./build-and-test.md)准备依赖。改过 Backend 时，探针会检查构建新鲜度；独立 Electron E2E 则按对应 package script 准备产物。

## 首批场景

| 用户行为 | 最小夹具和必须成立的结果 | 自动化入口 | Owner |
| --- | --- | --- | --- |
| 从有文件的项目新建空项目，展开后再删除 | 两个独立项目、一个打开的文件及项目内对话。新项目不带旧文件；空历史展开不先撑高再回跳；删除只清理目标项目的对话及关联数据，不能把它们移到顶层。 | 项目导航 Electron 场景 `project-creation`；已有 `test:conversation-resource-link:electron` 还串联删除；后端级联与前端状态见下面定向命令。 | [项目生命周期](../../src/domains/projects/README.md)、[删除编排](../../src/app-hosts/linnya/application/project-deletion/README.md) |
| 打开长对话、向上翻历史、切换模型 | 带工具结果的对话和独立于消息窗口的上下文估算。显示当前模型的用量；上翻历史不清空；加载态、失败态和重新估算不互相冒充。 | `projectContextWindowUsage.test.ts`、`ContextWindowUsageDropdown.integration.test.ts`；涉及后端读取还跑 `sqliteUiMessagesReader.test.ts`。界面时序使用隔离探针，不把展示投影测试当作全链路估算验收。 | [上下文用量](../../apps/renderer/domains/conversation/features/context-window-usage/README.md) |
| 接受文档修订，再关闭重开 | 一篇带嵌套格式、引用、未保存编辑和 pending 修订的文档。接受只改变提议部分，格式与块身份保留，重读仍有效；冲突失败不丢正文或 pending。 | `pendingRevisionApplyService.test.ts`、`pendingInsertEditorIdentity.integration.test.ts`。修改解析器或编辑器时再补相应 owner 测试与探针视觉验证。 | [Markdown](../../src/domains/markdown/README.md) |
| 快速拖动侧栏或表格列 | 独立项目和可见分隔线。逐步拖动采样必须跟手；结束宽度正确、期间不跟手仍算失败；重启后偏好保留。 | 项目导航 Electron 场景 `sidebar-resize`；`test:desktop-probe:real` 覆盖真实概览列宽。不要只比较起点和终点截图。 | [Desktop 探针](../../scripts/development/features/desktop-probe/README.md) |
| 自定义嵌入、重排、OCR、生图模型 | 隔离设置页和官方协议本机 HTTP fixture。测试与保存分离，错误/主动取消保留草稿并中止实际请求；保存、详情重开、用途选择和刷新后目录/绑定保持。不得把模拟当成真实供应商质量认证。 | `pnpm exec tsx scripts/e2e/custom-models/desktop.acceptance.mjs`；协议/重启持久化见 `customCapability*.integration.test.ts`。 | [Custom API onboarding](../../src/app-hosts/linnya/application/custom-api-onboarding/README.md) |
| 知识库摄入、检索与启停 | 隔离 Desktop 的正式 Backend 插件、3 条生产 Worker、Qdrant 与官方协议合成服务；Markdown、PDF OCR、静态图片落盘可读，图谱与检索完成，停用撤销入口且保留原文，再启用与正常删除可用。 | `pnpm exec tsx scripts/e2e/knowledge-plugin/desktop.acceptance.mjs`；不等同于模型供应商质量或安装包验收。 | [知识库](../../packages/plugins/knowledge/README.md) |
| 知识库自己的元数据损坏 | 新建两份合成项目/对话，仅在探针自己的数据库注入 SQLite 写入故障；App 仍就绪且两个对话可见，知识库入口显示明确通知；修复后停启恢复，退出无残留。 | `pnpm exec tsx scripts/e2e/knowledge-plugin/startup-failure.acceptance.mjs`。Host 主库迁移失败属于另外的必需启动门禁。 | [知识库运行时](../../packages/plugins/knowledge/README.md#激活任务与恢复) |
| 后台异常后关闭 App | 仅对测试自己启动的后台/受管进程制造异常。关闭不能静默卡住；存储准备失败允许重试；退出后自有进程无残留。 | `createMainWindowCloseLifecycle.integration.test.ts`、`createWindowClosePreparationHost.integration.test.ts`；进程所有权变更还跑 `test:shell-tool:production-app-owner-close`。探针看管器异常不等同于产品后台异常。 | [Electron Main](../../src/electron-main/README.md)、[Shell 运行合同](../../src/tools/commands/shell/README.md) |

项目与文档的定向命令：

知识库场景默认使用开发插件入口。验证完整 Renderer artifact 时，先按正式构建流程准备 `extraResources/plugins`，再设置 `KNOWLEDGE_PLUGIN_MODE=bundled` 运行同一摄入场景；回执记录实际模式和加载入口。开发模式不能代替随包插件验收。

```bash
pnpm exec vitest run src/app-hosts/linnya/application/project-deletion/__tests__/projectDeletion.integration.test.ts apps/renderer/app/layout/orchestration/projectDeletion.integration.test.ts apps/renderer/app/layout/orchestration/openProjectWorkspaceFromSidebar.test.ts
pnpm exec vitest run apps/renderer/domains/conversation/features/context-window-usage/functions/projectContextWindowUsage.test.ts apps/renderer/domains/conversation/features/context-window-usage/ui/ContextWindowUsageDropdown.integration.test.ts src/app-hosts/linnya/adapters/persistence/event-store/ui-projection/__tests__/sqliteUiMessagesReader.test.ts
pnpm exec vitest run src/domains/markdown/features/pending-revisions/orchestration/__tests__/pendingRevisionApplyService.test.ts src/domains/markdown/features/pending-revisions/orchestration/__tests__/pendingInsertEditorIdentity.integration.test.ts
pnpm exec vitest run src/electron-main/app-lifecycle/orchestration/createMainWindowCloseLifecycle.integration.test.ts src/electron-main/app-lifecycle/orchestration/createWindowClosePreparationHost.integration.test.ts
```

项目导航 E2E 已有多种场景，共用正式启动入口。选择其中一个运行即可，例如：

```bash
pnpm exec cross-env LINNYA_CONVERSATION_E2E_SCENARIO=project-creation pnpm run test:conversation-navigation:electron
pnpm exec cross-env LINNYA_CONVERSATION_E2E_SCENARIO=sidebar-resize pnpm run test:conversation-navigation:electron
```

这些旧 Electron E2E 可能显示窗口并取得焦点；无人值守的界面排查优先用隐藏探针。新增回归优先复用已有业务夹具、正式 CLI/导航和探针动作，不再添加固定睡眠或另一套点击 DSL。

## 证据和收尾

项目概览、通用菜单、表格拖动或探针本身的改动，先运行 `pnpm -s probe accept overview`。
标题栏、侧栏宽度、更新入口或界面文案长度的改动，运行 `pnpm -s probe accept header`，按侧栏宽度、语言、更新状态、全屏和窗口宽度组合扫标题栏几何不变量；断言读元素矩形，截图只作证据。
这一命令已经自动生成具名业务断言、截图、菜单定格、逐步拖动采样、操作步骤和进程清理结果。
其他业务仍按上表选择对应入口；不要把概览场景通过当成对话、文档编辑或数据迁移已验收。
新场景复用[验收证据](../../scripts/test-runner/features/acceptance-evidence/README.md)及探针动作，自动保存附件，不再手工复制截图。

涉及数据丢失/误改、启动退出阻断或反复复发的 bug，补一轮反向证据：同一测试在旧实现上必须发生目标行为断言失败，
再在修复后通过。先保持新测试与夹具不变，只切换要验证的实现；编译失败、进程启动失败或跳过不能算复现。
Vitest 可加验收 reporter 导出具体断言及错误类型；旧实现的执行也应在自己拥有的工作区或登记的临时 checkout 内，结束恢复源码。

每次结果至少记录被测 commit、未提交源码摘要、具体场景/夹具、命令、退出状态以及日志和必要截图路径。拖动/动效保留原始采样，持久化用正式读取结果断言。截图负责检查视觉，不能替代业务数据正确性；源码变化后旧结果不能当作新候选已通过。索引本身不表示这些场景已经在当前候选执行。

只在独立测试数据内创建、删除和制造故障，不写日常 `_dev_data`，不依赖相邻 checkout。探针成功后先保存必要截图/日志，再 `stop --clean`；失败先 `stop` 保留复现现场，定位完成后仅回收自己这次实例。原生系统对话框、签名、安装、更新与 Windows 行为仍走各自平台验收。
