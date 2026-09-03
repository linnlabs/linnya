# McKinsey Research

这是一个面向 Linnya 的内置商业研究 skill，用于把上游的 McKinsey-style strategy analysis 方法论本土化到 Linnya 的 agent、tool 和 evidence 体系里。

## 这个 skill 做什么

它适合以下任务：

- Market Research
- Competitive Landscape
- TAM / SAM / SOM
- Customer Personas
- Pricing Strategy
- Go-To-Market Planning
- Financial Modeling
- Risk Assessment
- Market Entry Strategy
- Feasibility Study

它不是一个“随便搜一搜”的轻量 skill，而是一个较重的咨询分析 workflow。
它提供的是咨询分析框架，不是自动生成尽调结论的机器。

## 在 Linnya 里的工作方式

这个 skill 的执行方式和上游平台不同。

- 父 agent 负责激活 skill、读取资源、组织流程、汇总结论。
- 子 agent 通过通用 `subagent` 分段 research，并把详细发现写入项目 Workspace 文档；父 agent 通过 `read_file` 读取交接产物。
- 最终面向用户的正式产出，优先是 Workspace Markdown 文档，而不是任意本地 `artifacts` 文件。

## 为什么这里保留这个 README

这个文件是给 Linnya 维护者看的，不是给上游平台用户看的。

保留它的目的：

- 说明这个 skill 的来源和定位
- 解释为什么 `SKILL.md` 已经与上游版本不同
- 帮助后续维护者理解哪些内容是“方法论保留”，哪些内容是“Linnya 本土化适配”

## 已完成的本土化调整

- 目录名已与 skill name 对齐，确保能被 Linnya 的 skill discovery 正常发现
- `SKILL.md` 已改成 Linnya 可执行的工具词汇
- 执行模型改为父 agent + 子 agent 分工
- 证据策略改为先内部资料、后外部检索
- 最终产出改为 Workspace 文档，而不是上游的 `artifacts/...html`
- 协作交接已退出 SharedMemory URI，统一使用 Workspace 文档与 canonical 文件工具

## 暂未调整的部分

以下内容目前保留上游方法论，后续再讨论是否继续本土化：

- 18 项 intake 结构
- 12 个分析 prompt 的详细内容
- 整体分析深度与批次数量

## 文件结构

```text
mckinsey-research/
├── SKILL.md
├── references/
│   └── prompts.md
├── README.md
└── _meta.json
```

## 上游来源

- Origin: `Abdullah4AI/mckinsey-research`
- Localized for Linnya as a builtin skill package
