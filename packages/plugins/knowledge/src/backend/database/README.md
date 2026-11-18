# 知识库数据库

八张表及其索引只由本目录定义，Backend contribution 通过 `knowledgePluginMigrations` 注册，
表清单来自插件 manifest 的 `ownedTables`。Host 不再安装知识库 schema provider。

首次插件 migration v1 使用原表名、主键、外键和列序：新库建表，已有库原地接管。
`embedding_space_id` 留在 knowledge_bases 的最后一列；已有索引来源未知时保持 NULL，
不能从当前配置反填。历史 Host v79→v80 migration 继续保留，先于插件 lifecycle 执行。

此迁移不重写资料 ID、项目关联或图谱事实，不访问 SoT、原件、Qdrant 或任务临时目录。
这些文件与向量的路径稳定性由实际插件运行验收覆盖，数据库测试不能替代。

沿用 Host 既有生命周期：已安装但禁用仍迁移；卸载保留表与账本，重新安装复用。
这不新增界面的卸载或远程更新入口。后续 schema 变化递增插件 migration，不修改 Host schema 版本。
