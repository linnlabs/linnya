# Agent Shell 内建 CLI

`linnya changes` 查询当前对话所属项目里保留的文档改动。它与 `linnya-<插件>` 共用 Shell 的原生客户端、权限、取消和输出通道。Core 命令由 Host 注册，无需启用插件。项目由 Host 查询已授权对话的归属。

- `linnya changes --day yesterday` 按宿主当地日历列出昨天的记录。也接受 `today` 或具体日期。
- `linnya changes --since 2026-11-01 --until 2026-11-06` 包含起日，不含终日。
- `linnya changes --run ROOT_RUN_ID --limit 20` 包含该根运行及其子运行。日期和运行可以组合。
- 默认返回最近 30 项，最多 200 项。超过条数或 Shell 展示预算时，完整 JSON 中的 `truncated` 和 `notice` 明确说明截断。时间以带时区的 ISO 格式输出。隐藏或已入回收站的节点没有活动路径。

每项是同一执行者对同一文档的保留记录。覆盖范围、精简与跨项目的可见规则见[行动账本](../../../../domains/action-ledger/README.md)。这里只开放只读查询。外部脚本用的 Conversation CLI 见 [Linnya CLI](../../../../../apps/linnya-cli/README.md)。

## 配色

`linnya palette` 给 Agent 出配色、检查配色。算法与错误码归 [color-palette domain](../../../../domains/color-palette/README.md)。不读内部数据，只在 `--preview` 时需要写权限。

- `linnya palette suggest <图片>...`：从 1–20 张图取色，默认给 3 套。可选 `--color` 指定主色（1–6 个）、`--seed` 补充本色、`--accents` 定强调色数量、`--n` 定套数、`--base` 定底色明暗、`--avoid` 排除颜色、`--rng` 复现之前的结果。
- `linnya palette check --bg --sf --ink --mu --ac --ch`：检查自己写的一套，可加 `--excluded`、`--color`。不合格时退出码为 1，并给出改动最少的版本。

图片是当前对话工作目录里的相对路径或 `conversation:/...`，边界与 `read_file` 相同，符号链接不能带到目录外。相对路径按工作目录根解析，不跟随 Shell 的 `cd`。`workspace:/` 和 `file:///` 按读不出处理。

默认输出是给模型读的紧凑文本：首行取色结论，之后一行一套。`--json` 输出 `@app/schemas/color-palette` 的 DTO，并附 `skippedImages` 和 `preview`。

颜色参数可以不带 `#`，因为 Shell 会把未加引号的 `#` 后面当注释。退出码：0 成功，1 业务失败或检查不合格，2 用法错误。失败时 stderr 是 `错误码 一句原因`。

`--preview` 把几套色条画成 PNG 写进工作目录根。文件名带随机后缀并独占创建，不会跟随预先放好的符号链接。
