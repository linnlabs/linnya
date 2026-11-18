# 知识库项目 CLI

`definitions` 声明七类命令与错误，`functions` 解析参数并复用知识库项目范围规则，
`orchestration` 在 Host 权限通过后调用既有业务用例。此处不创建另一套数据库、摄入器或模型客户端。

## 权限与输入

`prepare` 只解析参数。执行时从 Host 冻结的 `projectId` 读取真实关联；读取失败直接失败，不能退回默认库。
没有任何关联时的 `default` 只读。导入、删资料和重建要求该项目的显式 `read_write`；
`unlink` 只移除当前显式关联，不删除库、不影响其他项目。删资料还会验证文档实际属于获准库，不属于时按权限拒绝（77）。
Host 另校验父 Shell 的内部数据访问和写权限，业务角色不能替代它。

导入只声明会话文件读取。Host 在当前会话文件 admission 下检查正式 locator、普通文件与 50 MiB 上限，
复制进既有受管上传暂存区；知识库只拿副本，队列接纳后才转交暂存文件所有权。
帮助、列表、索引状态和解除关联不取得文件或模型端口。

已有索引的嵌入模型优先；其他所需模型来自父运行冻结的四用途快照。缺少必要用途时报错，
不从全局目录任选一个模型，也不接受 CLI 模型参数。PDF 的文本解析不要求额外 OCR 模型；
需要 OCR 或图片识别时仍由正式解析能力报告缺少配置。

## 执行与结果

完整语法见 [`KNOWLEDGE_CLI_HELP`](./definitions/knowledgeCliCommand.ts) 与产品 Skill。
成功 stdout 为单行 JSON `{ok:true,command,data}`，失败 stderr 为 `{ok:false,error:{code,message}}`。

| command | data |
| --- | --- |
| `list` | `projectId`、`libraries`（`id/name/role/implicit`） |
| `documents.list` | `kbId`、正式 `KnowledgeDocument[]` 的 `documents` |
| `documents.import` | `kbId/jobId/document/graph`；重复时为 `kbId/jobId/status:duplicate/message` |
| `documents.delete` | `kbId/documentId/deleted:true` |
| `index.status` | `kbId/identity`（可空的 `modelId/spaceId`）、`rebuild`（最近一次任务或 null） |
| `index.rebuild` | 正式 `KnowledgeIndexJobStatus`，成功时 `status:completed` |
| `unlink` | `projectId/kbId/unlinked` |

退出码 0 成功；2 `usage_error`；77 `permission_denied`；130 `cancelled`；1 `operation_failed`。
Host transport 错误仍遵循其独立的退出码/协议，不混入插件业务错误。

导入等待自身真实 Worker、Host 请求、派生图谱抽取与索引和已有重试收口；重试一次失败后成功可以成功返回，
耗尽或取消不能成功。队列完成事件后会释放大结果，本命令只临时保存重复判定与说明，最终读取真实持久化状态。
父取消只取消本次执行；全插件停用则沿既有全部知识库活动 drain，仍不取消普通对话或 Audio。
重建保持原文，身份变化/失败恢复沿已有显式重建路径，不自动替换模型或重建其他库。

## 验证

参数与角色规则在相邻业务测试覆盖；`packages/plugins/__tests__/knowledgeCliExecution.integration.test.ts`
使用真实 SQLite、Host 受管 Worker 和推理消息合同验证终态、重试、取消与 UI 并行隔离，生产者为受控测试 Worker。
正式产品摄入、文件与向量一致性最终由安装态 Desktop 的 Agent → Shell → 原生 CLI 验收，不能用测试生产者替代。
