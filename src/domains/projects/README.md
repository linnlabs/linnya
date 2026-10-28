# Project

Project 是一套数据工作区内的业务组织单位。项目拥有名称、描述、系统角色及生命周期，以 `project_id` 关联文档树、会话和知识库。创建项目只写入当前 Backend 已打开的数据库，不创建目录、数据库或 Backend，也不切换界面。术语和各层身份见[产品模型](../../../docs/product-model-overview.md#20-workspaceproject-与导航上下文)。

## 公开入口与所有权

调用方只从 `index.ts` 导入 `createProjectLifecycle`、`ProjectLifecyclePort`、`ProjectMutationPublisher`、项目错误和身份查询。Desktop Project IPC 与 CLI 的项目查询、创建和修改共同使用此入口。`WorkspaceService` 只处理项目文档树，不再提供项目 CRUD。

跨端记录与输入的唯一合同在 `packages/schemas/src/project.ts`。`features/lifecycle/definitions` 定义持久化行，`functions` 持有项目规则与投影，`persistence` 拥有项目 SQL，`orchestration` 组织输入准入、事务和持久化步骤。

项目表 DDL 由本 domain 的 `PROJECT_SCHEMAS` 提供，既有文档树 schema 组合根仍将它与节点 DDL 一起交给 DatabaseService。保留 `projects` 表、字段和索引身份；本次 owner 拆分不需要数据迁移。项目文档统计仍属于文档树读取能力，不属于项目记录生命周期。

## 业务规则

- 名称去除首尾空白后非空，唯一性沿用数据库的精确字符串规则；重名返回 `ProjectNameConflictError`。
- 查询、更新和删除不存在或已删除的项目返回 `ProjectNotFoundError`；空更新被拒绝。
- 默认项目由 `system_role = default` 识别，改名不改变其身份；普通创建不接受系统角色。
- 默认项目不可删除；`can_delete` 只表示系统角色允许删除，不表示已完成关联数据或运行活动预检。
- 创建时清理历史同名软删除行与插入新行在同一事务中完成。

## 写入通知

`project-mutation-events.ts` 拥有跨端的 `project.created / project.updated / project.deleted` 事实合同。
当前 Host 将 Project lifecycle 作为独立事务入口：创建或更新事务完成后，才调用显式注入的
`ProjectMutationPublisher`；失败写入不发通知，`ensureDefault` 仅在实际插入时发布创建事件。
带通知的生命周期调用不能包在另一个尚未提交的事务中；若未来需要跨域原子流程，应由该流程持有提交与发布边界。

Desktop IPC 与 CLI composition 均注入同一个 `BackendRendererIntegrationPort` 发布能力，
复用 [Workspace Mutation Bus](../../../docs/workspace-mutation-bus.md) 的传输。Project 不查询 Workspace registry，
事件也不携带导航指令。Renderer 只重读项目列表，不能按当前项目过滤其他项目的创建或改名。

## 删除边界

CLI 只使用 `deleteEmpty`：默认项目拒绝，普通项目只能在一个同步事务中删除自身记录。
SQLite 的 `total_changes()` 差值包含外键级联和 trigger 写入；若差值不是 1，则抛出
`ProjectNotEmptyError` 并回滚整个事务。因此软删除历史、Conversation 的 SET NULL、项目资源、
知识库/待办以及未加载插件的关联都不会被隐式清掉。普通 statement.changes 不包含这些影响，不能代替。
[SQLite 合同](https://sqlite.org/c3ref/total_changes.html) 是该实现的依据；事务中不运行异步步骤或发布通知。
`NO ACTION` 外键冲突映射为非空；`RESTRICT` 与其他拒绝删除的 trigger 映射为 `ProjectDeleteBlockedError`，
不解析错误消息猜业务类别。只有提交后发布 `project.deleted`。

这依赖 DatabaseService 已启用的外键约束。Core 与插件的项目归属必须通过真实 FK 表达；
日志和可重建索引不定义业务归属，不能用 JSON 中的偶然 project_id 代替正式关系。
本实现不遍历其他 domain 的表或加载停用插件；不新增各 owner 可能漏注册的全局检查器。
代价是拒绝非空项目时会在事务中执行并回滚关联写入，成本随关联数据量增长。
需要面向大项目的删除预览时，应另加各 owner 的只读影响报告，不把预览当成最终提交许可。

`delete` 是 Desktop 保留的历史物理删除入口：文档节点按现有外键级联删除，Conversation 按自身外键解除项目关联，知识库仅删除项目绑定。该入口不负责停止运行、删除会话工作目录或清理所有资产字节。涉及这些 owner 的完整删除流程应进入 App Host 的跨域编排；不能把项目记录删除宣称为完整清理，也不能在新增 Project CLI 时直接推导出完整删除能力。

## 验证

从仓库根运行 `pnpm exec vitest run src/domains/projects src/features/workspace/node-transfer src/electron-main/ipc/handlers/projects src/app-hosts/linnya/adapters/conversation-control-bridge/__tests__`，覆盖项目生命周期、文档归属与 Desktop 合同。项目代码不依赖 Electron 或 Renderer。
