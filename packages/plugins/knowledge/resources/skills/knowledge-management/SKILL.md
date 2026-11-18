---
name: knowledge-management
description: Manage the current project's existing knowledge libraries and documents through the Linnya knowledge CLI. Use for importing conversation files, listing or deleting knowledge documents, rebuilding indexes, or unlinking a library.
metadata:
  author: linnya
  pluginId: knowledge
  version: "0.1.0"
---

# 知识库资料管理

先运行 `linnya-knowledge list` 取得当前项目真实可访问的库 ID，再用
`linnya-knowledge documents list --kb <id>` 查看资料。知识检索继续使用已启用的知识库检索工具。
不要猜 ID，也不要从其他项目或历史引用中取得 ID 后绕过当前范围。

可用操作：

- 导入：`linnya-knowledge documents import --kb <id> --source conversation:/<file>`。
- 删除一份资料：`linnya-knowledge documents delete --kb <id> --document <id>`。
- 查看索引：`linnya-knowledge index status --kb <id>`。
- 重建：`linnya-knowledge index rebuild --kb <id>`。
- 解除当前项目关联：`linnya-knowledge unlink --kb <id>`，不会删除库或其他项目的关联。

写操作调用 Shell 时传 `requires_write_access: true`，还需要当前会话已获准访问内部数据。
导入、删除与重建仅允许显式 `read_write` 关联；没有关联时的 `default` 范围只读。
没有所需权限时说明缺少哪种授权，不尝试绝对路径、其他命令或改库角色绕过。
已有库的新增关联、创建/删除库和模型设置由产品界面处理，本 CLI 没有这些命令。

导入只接受当前对话工作目录里的正式 `conversation:/` locator，单文件最多 50 MiB。
需要从网页或其他获准来源准备资料时，先保存为当前对话文件；CLI 复制到受管暂存目录，保留原文件。
不要把资料作为大段 JSON/base64 参数传入，也不要传操作系统绝对路径。

导入和重建会等待本次工作结束。启用图谱的库还会等待本次文档的抽取与图谱索引；长操作由
Shell 的进程句柄继续等待或取消，不能看到任务已入队就宣称完成。
成功 stdout 是一行 `{ok:true,command,data}`；失败 stderr 是一行
`{ok:false,error:{code,message}}`。退出码 2 是参数错误，77 是权限不足，130 是取消，1 是业务失败。
以真实退出码和结果为准；错误消息说明保留资料与后续恢复方式。

模型沿用已有索引的嵌入模型和父运行冻结的用途配置，不支持命令行临时指定模型。
缺少必要模型时提示用户配置后重新发起；重建需要模型调用费用，但不删除已保存原文。
重复且已有可恢复原文的资料不会再保存第二份，按回执指引重建；确需重新解析时先明确删除旧资料。
取消只停止本次命令及其派生工作，不取消用户同时发起的其他摄入或对话。
