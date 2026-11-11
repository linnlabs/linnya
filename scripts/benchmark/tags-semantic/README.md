# 标签基准

检查 Agent 用内置 `linnya-tags` Skill 打标签的质量：该打时打得准、不该打时不打、标签不过多，以及有了标签后回答类型/状态问题是否更省。

## 资料与任务

`fixture.mjs`：一个“新能源车出海调研”项目，12 份 Markdown 平铺在根目录，文件名不写类型——论文 3、访谈纪要 3（2 份提到价格）、会议记录 2、文稿 4（草稿 1、修改中 1、定稿 2，各有作者）。

`run.mjs` 用同一份资料建两个项目，依次运行：

| 步骤 | 项目 | 问题 | 期望 |
|---|---|---|---|
| control | 对照 | 列出定稿文稿和作者 | 只能搜索、读文件；作为 token 基线 |
| oneoff | 标签 | 哪些访谈提到价格 | 直接答，不建标签、不保存筛选 |
| organize | 标签 | 整理项目，分清类型，文稿看出进度和作者 | 少量类型标签 + 单选状态字段 + 作者字段 |
| track | 标签（接 organize） | 做一个能按进度看的视图 | 保存按状态分列的看板 |
| query | 标签（新对话） | 列出定稿文稿和作者 | 用 `linnya query` 查到 |

## 运行

先启动开发实例（`pnpm run dev:electron`），驱动通过它的 CLI 连接文件建项目、发消息。

```bash
node scripts/benchmark/tags-semantic/run.mjs \
  --model <model_config_id> --label deepseek \
  --db "$PWD/_dev_data/workspace/workspace.sqlite" --output <新目录>
node scripts/benchmark/tags-semantic/score.mjs <结果目录> [<结果目录> …] --out <目录>
```

标签和字段是工作区级的：驱动默认要求工作区还没有标签；已有标签时加 `--allow-existing-tags yes`，
这时测的是“先看已有、能复用就复用”，评分只把本轮新建的算作新建。Shell 命令审批按“本对话允许”自动通过，其他交互不代答。
`--only control,oneoff` 只跑部分步骤，可用 Mock 模型检查管道（不花钱）。每步还从会话消息里记下执行过的 Shell 命令原文；
旧结果缺这一项时用 `run.mjs --backfill <结果目录>` 补（实例需在运行）。

## 评分

`score.mjs` 只读打开实例数据库：标签名不设标准答案，每类资料取重合最多的标签当作该类标签，再判断每份文档；
文稿状态按选项名归到草稿 / 修改中 / 定稿；回答按文件名和作者判断。另报新建的标签与字段、主题标签、每份文档标签数、保存的筛选和各步 token（审计 `response` 档）。
