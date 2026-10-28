# 项目文档树与 VFS

本目录承载项目中的文档节点、文档生命周期、路径投影和文档读取能力。历史 `workspace` 前缀表示文档树能力族，不表示这里拥有整个数据工作区的业务，也不是 Project 的另一个名称。

- **Project 记录与生命周期**：使用 [`domains/projects`](../../domains/projects/README.md) 的公开入口。
- **数据工作区根目录**：由 [`runtime-paths`](../../shared/runtime-paths/README.md) 表达，外层 Host 在启动时解析并冻结。
- **Backend 唯一运行 owner**：由 [workspace-ownership](../../app-hosts/linnya/backend-runtime/features/workspace-ownership/README.md) 管理。
- **项目文档路径**：由 [VFS](./vfs/README.md) 在明确 `projectId` 的上下文中解析。
- **会话工作目录**：由 [`conversation-files`](../../domains/conversation-files/README.md) 拥有。

项目文档的稳定身份是节点 ID，项目归属是 `project_id`，虚拟地址是 VFS path。`workspace_nodes` 和 `workspace:/` 保留其已有存储与工具合同，不增加同义表、协议别名或运行时双读。路径相同不代表跨项目文档相同；Project ID 也不能用作宿主目录路径。

项目生命周期不经过 `WorkspaceService`；该历史门面只提供节点树、文档活动和项目文档统计。跨项目节点转移使用 Project 的公开身份检查，不自行解释项目生命周期。修改前按具体能力阅读相邻 feature README。
