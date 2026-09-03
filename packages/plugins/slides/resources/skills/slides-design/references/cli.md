# Slides CLI：Agent 使用合同

`linnya-slides` 是通用 Shell 可调用的 Slides 检查与像素渲染入口。它不创建、编辑或导出文稿；内容变更仍通过 Workspace 文件工具写 deck.js。产品界面的“更多”菜单可以导出 PPTX，但 Agent 当前没有 export 子命令或可调用的 PPTX export 工具。

质量检查有两个等价入口：`ppt_inspect` 适合直接消费精简 observation，`linnya-slides inspect` 适合取得完整机器 JSON 后用 Shell、脚本或 benchmark 处理。两者共享同一套 inspection 事实和问题分级，按消费方式选择即可，不要求重复执行。

## presentation ID

CLI 的 `--presentation` 接收 presentation ID，不接收 Workspace locator、inode 或文件名。ID 来自：

- `write_file` / `edit_file` 成功 observation 中的 `presentation_id`；
- `read_file` 结构化结果中的 `details.presentationId`。

不得根据路径或文件名猜 ID。

## 命令选择

| 目的 | Agent 入口 |
|---|---|
| 页面内容、代码组织和源码位置 | `read_file(locator="workspace:/.../*.slides")` |
| 构建状态、检查提示、证据和建议 | `ppt_inspect`（精简 observation）或 `linnya-slides inspect --presentation <id>`（完整机器 JSON） |
| 指定页的 JPEG 检查图 locator | `linnya-slides render --presentation <id> --slide <number>` |
| 检查某个字体族 | `linnya-slides fonts check --family <name>` |
| 按脚本查候选字体 | `linnya-slides fonts list --script <latin\|eastAsian\|complex>` |

`inspect` 和 `render` 可用 `--slide N` 选择单页，或用 `--from N --to M` 选择闭区间；单页和范围不能同时传。省略这三项表示整份文稿。`inspect` 可用 `--max-slides N` 限制返回页数，也可用 `--heuristics` 附加 Tier-2 低置信提示。CLI 只执行显式选择，不会根据任务类型自动挑选页面。

以下最小样例会由 Skill guard 送入真实参数解析器：

- `linnya-slides inspect --presentation example-presentation`
- `linnya-slides inspect --presentation example-presentation --slide 1 --heuristics`
- `linnya-slides render --presentation example-presentation --slide 1`
- `linnya-slides render --presentation example-presentation --from 2 --to 4`
- `linnya-slides fonts check --family Inter`
- `linnya-slides fonts list --script eastAsian --limit 20 --offset 0`

## Shell 与输出

- `inspect` 是只读命令。stdout 是一个紧凑 JSON report，运行日志在 stderr。
- `inspect` 返回 `buildStatus + findingSummary + rootGroups + findings`，不返回综合分、passed 或美学 blocker，也不复制 `read_file` 已能提供的页面结构。先处理 P0 确定性问题，再复核 P1；P2 要结合 render 判断。`shared_source` 根因组表示多条 finding 指向同一 element 级源码控制点，可优先一次修正，不代表视觉规则替用户决定设计。
- `render` 会向当前 Conversation 工作目录写 JPEG 检查图，因此调用 Shell 时传 `requires_write_access: true`。Agent 模式不要传 `--output`、`--overwrite` 或 `--database`。
- Shell 返回 `completed` 只表示进程已结束；仍要确认真实 process exit code 为 0。长任务若返回 process handle，用 `process` 跟进到终态。
- render 成功后，stdout 是单行 JSON，`presentation` 给出版本，`slides[]` 逐页给出 `slideNumber + locator`。把需要查看的 locator 直接交给 `read_file`，不要拼接路径。
- render exit code 非 0 或 stdout JSON 不完整时，不得猜测 locator 或继续读图片。
- 新建或整稿改版的迭代阶段可以先渲染代表页，最终 revision 应检查全部页面；页数多时用 `--from/--to` 分批。局部修改只需在最终 revision 重新渲染全部受影响页面。CLI 不保存“已经看过”的状态，Agent 必须确认截图属于当前 revision，并以 `presentation.versionId + slideNumber` 记录本轮视觉输入：同一身份最多读取一次，收齐后先汇总问题再编辑；编辑后只读取新 report 中受影响页的 locator。
- 对 `conversation:` 文本或图片使用 locator；不要传 inode、占位 offset 或绝对路径。

## 参数边界

Agent facade 明确禁止 `--database`。render 的当前版本工作集由宿主管理，因此也禁止 `--output` 和 `--overwrite`。`--width`、`--pixel-ratio` 是 render 专用；一般像素检查无需覆盖默认值。standalone CLI 才能用 `--output` 与 `--overwrite` 管理自己的显式目录。
