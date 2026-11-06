# Slides 设计基准批次

本 feature 把“同几份简报各跑若干次、看成稿整体水平”的 Slides 设计实验固化成一条命令。它只编排真实 Conversation
CLI，不读数据库、不打分；成稿的检查、渲染和统计由仓库脚本
`scripts/benchmark/slides-design/analyze.ts` 完成，视觉评分仍由人对照样张进行。

## 使用

先启动 Linnya 开发环境，再写一份 manifest：

```json
{
  "schema_version": 1,
  "name": "slides-design 2026-11 batch 1",
  "model": "<model-id>",
  "reasoning": "high",
  "concurrency": 6,
  "timeout_minutes": 90,
  "max_approvals": 4,
  "briefs": [
    { "key": "bronze", "prompt": "做一份 Slides 演示文稿：……不用问我，直接做完。", "runs": 6 }
  ]
}
```

```bash
pnpm benchmark:slides-design --manifest /absolute/manifest.json --output /absolute/result-dir
pnpm benchmark:slides-design:analyze --batch /absolute/result-dir
```

parser 是 `definitions/slidesDesignBatch.ts`：`agent` 默认 `slides_agent`，`model`
省略时用 App 默认路由；每份简报 `runs` 次，最多 12 次；`concurrency` 是同时进行的试跑数。

## 运行语义

- 每次试跑先 `linnya projects create` 建一个新项目，再按普通 Benchmark case 的语义运行：复用
  `runBenchmarkCase`，计划卡等待批准时自动批准，最多 `max_approvals` 次；Shell 命令审批不自动批准。
- `batch.json` 在每次状态变化后原子写入，记录项目、会话与运行身份、结果和耗时；每次试跑的完整事实写在
  `runs/<试跑>.facts.json`。
- 同一输出目录再次执行即续跑：只发出 `pending` 的试跑。上次中断时仍在进行的试跑标为
  `interrupted`，不重发，需要按 `batch.json` 里的身份人工核对。manifest 的试跑列表变了要换新目录。
- 单次试跑失败（建项目失败、CLI 出错）记为 `runner_failed`，不影响其他试跑。

## 分析输出

`analyze` 只读打开工作区数据库，按项目找到成稿后：

- `decks/<试跑>.inspect.json` 和 `decks/<试跑>/slide-NNN.jpg`：inspect 报告与 960px 渲染；
- `sheets/<试跑>.jpg` 逐稿样张，`sheets/covers.jpg` 全部封面；
- `metrics.json` 与 `summary.md`：页数、阅读方式、P0/P1/P2、低于阅读方式字号下限的文字占比、主底色与米色底、有图页与图片面积、左上标题页占比和页面类型分布。

这些是结构事实，不是质量分。页面类型按几何粗分，只用于看分布是否单一，不作为版式配额。
