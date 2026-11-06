# Agent Shell 内建 CLI

`linnya changes` 查询当前对话所属项目里保留的文档改动。它与 `linnya-<插件>` 共用 Shell 的原生客户端、权限、取消和输出通道。Core 命令由 Host 注册，无需启用插件。项目由 Host 查询已授权对话的归属。

- `linnya changes --day yesterday` 按宿主当地日历列出昨天的记录。也接受 `today` 或具体日期。
- `linnya changes --since 2026-11-01 --until 2026-11-06` 包含起日，不含终日。
- `linnya changes --run ROOT_RUN_ID --limit 20` 包含该根运行及其子运行。日期和运行可以组合。
- 默认返回最近 30 项，最多 200 项。超过条数或 Shell 展示预算时，完整 JSON 中的 `truncated` 和 `notice` 明确说明截断。时间以带时区的 ISO 格式输出。隐藏或已入回收站的节点没有活动路径。

每项是同一执行者对同一文档的保留记录。覆盖范围、精简与跨项目的可见规则见[行动账本](../../../../domains/action-ledger/README.md)。这里只开放只读查询。外部脚本用的 Conversation CLI 见 [Linnya CLI](../../../../../apps/linnya-cli/README.md)。
