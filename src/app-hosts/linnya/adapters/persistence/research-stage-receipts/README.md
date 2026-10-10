# Research stage receipts

本 Host adapter 实现 Research application 的
`ResearchStageReceiptPort`，保存阶段恢复必需的冻结请求、输入文档绑定、预期新路径和已提交产物绑定。它不保存正文，不重建 prompt，不复制 RunSupervisor 的 running/completed/cancelled 状态；文档仍归 Workspace/Markdown，运行事实仍归 EventStore。

`research_stage_receipts` 以 parent run、父工具调用与 stage 为主键，parent
run 外键级联删除。project、conversation、model 必须与首次接纳一致。strict JSON
admission 保留实际 prepared
query 及方法资源列表；同阶段同参数 prepare 返回原回执，身份、输入版本、请求或目标路径变化全部拒绝恢复。新主 Agent 每次委派有独立 tool
call；`listRun`
查询本轮所有委派，以当前文档 inode 和版本选择依赖。同一研究阶段可有多次补查，但同一调用只能恢复原分配。新记录额外冻结主 Agent 的分配文字与 input_documents；旧记录无此字段，保持可读。

输入中保存的是文档 locator/inode/hash，不复制原文或把正文放进执行 metadata。

`prepare` 以短 IMMEDIATE 事务首次落盘；`assertPrepared` 只核对已冻结事实。
`commitArtifact`
只能在正式文档创建使用的同一个 SQLite 连接和事务内调用，重复相同绑定可重入，不同绑定明确失败。文档与产物绑定一起提交或回滚，不存在“文件已创建但无 receipt”恢复窗口。应用用例还必须核对最新输入文档版本并决定 stale 候选的保留与后继接纳；本 adapter 不把冻结记录误认为当前文档未变化，也不根据同名路径猜测产物身份。

Schema 由 DatabaseService 正式注册，是幂等 create-only 新表，不要求提升已有 Host
schema 版本。后续重启从 SQLite 原回执恢复同一 subrunId/request，不重新生成调用或偷换模型。

父级提交和子级委派共用表与原子文档事务。旧 child
JSON 保留 subrunId/request/delegation；父稿使用 runId/submission，不制造子运行或模型请求。父身份必须等于持久根运行。父调查主记录、初稿和修订各只允许一份成功产物；未保存的失败准备记录可保留，新调用修正文稿不消耗成功名额。commitArtifact 在文档事务内再次检查同根同阶段的成功父稿，防止并发双写。
