# Project

Project 是一套数据工作区内的业务组织单位。项目拥有名称、描述、系统角色及生命周期，以 `project_id` 关联文档树、会话和知识库。创建项目只写入当前 Backend 已打开的数据库，不创建目录、数据库或 Backend，也不切换界面。术语和各层身份见[产品模型](../../../docs/product-model-overview.md#20-workspaceproject-与导航上下文)。

## 公开入口与所有权

调用方只从 `index.ts` 导入 `createProjectLifecycle`、`ProjectLifecyclePort`、项目错误和身份查询。Desktop Project IPC 与 CLI 的现有项目查询共同使用此入口。`WorkspaceService` 只处理项目文档树，不再提供项目 CRUD。

跨端记录与输入的唯一合同在 `packages/schemas/src/project.ts`。`features/lifecycle/definitions` 定义持久化行，`functions` 持有项目规则与投影，`persistence` 拥有项目 SQL，`orchestration` 组织输入准入、事务和持久化步骤。

项目表 DDL 由本 domain 的 `PROJECT_SCHEMAS` 提供，既有文档树 schema 组合根仍将它与节点 DDL 一起交给 DatabaseService。保留 `projects` 表、字段和索引身份；本次 owner 拆分不需要数据迁移。项目文档统计仍属于文档树读取能力，不属于项目记录生命周期。

## 业务规则

- 名称去除首尾空白后非空，唯一性沿用数据库的精确字符串规则；重名返回 `ProjectNameConflictError`。
- 查询、更新和删除不存在或已删除的项目返回 `ProjectNotFoundError`；空更新被拒绝。
- 默认项目由 `system_role = default` 识别，改名不改变其身份；普通创建不接受系统角色。
- 默认项目不可删除；`can_delete` 只表示系统角色允许删除，不表示已完成关联数据或运行活动预检。
- 创建时清理历史同名软删除行与插入新行在同一事务中完成。

## 删除边界

当前普通项目删除仍是物理删除：文档节点按现有外键级联删除，Conversation 按自身外键解除项目关联，知识库仅删除项目绑定。该入口不负责停止运行、删除会话工作目录或清理所有资产字节。涉及这些 owner 的完整删除流程应进入 App Host 的跨域编排；不能把项目记录删除宣称为完整清理，也不能在新增 Project CLI 时直接推导出完整删除能力。

## 验证

从仓库根运行 `pnpm exec vitest run src/domains/projects src/features/workspace/node-transfer src/electron-main/ipc/handlers/projects`，覆盖项目生命周期、文档归属与 Desktop 合同。项目代码不依赖 Electron 或 Renderer。
