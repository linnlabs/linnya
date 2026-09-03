# Linnya Agent Benchmark CLI

这是面向真实 Linnya Agent 的开发 Benchmark Runner。它不自建 Agent runtime，也不读
数据库：每次运行都启动独立的 `linnya` CLI 子进程，依次使用
`send / status --watch / respond / stop / result / messages / audit` 控制正在运行的
Linnya App。因此生成的会话走正式 History，前端能按报告里的 `conversation_id` 看到。

## 使用

先启动 Linnya 开发环境，并准备一个真实 workspace project ID：

```bash
pnpm benchmark:agent list --pretty

pnpm benchmark:agent run slides_consulting_reference_v1 \
  --project <workspace-project-id> \
  --input reference_image=/absolute/path/reference.png \
  --pretty
```

可选参数：

- `--model <id>`：覆盖 App 默认模型路由；不传时使用正常默认路由。
- `--reasoning <level>`：覆盖 case 默认 reasoning。
- `--output <dir>`：覆盖默认报告根目录。
- 多输入 case 可重复使用 `--input key=value`。

图片不作为 CLI attachment 发送。Runner 只校验它是可读的绝对文件路径，再将路径插入
case prompt；文件读取、权限和失败语义都由真实 Agent/Host 链路负责。

## 注册一个 Case

一个 case 是 `src/cases/` 下的自包含 TypeScript 声明文件，只定义：稳定 ID 与 revision、
Agent/超时、prompt 模板、必需输入、`awaiting_user` 策略、产物期望和人工审阅维度。
超时属于 case 的运行预算：简单任务应保持较短，包含资料研究、完整制稿、渲染检查与
自修复的复杂 Slides case 可以按小时配置，避免把已交付产物但仍在质检的运行误判为失败。

新增流程只有两步：

1. 在 `src/cases/` 新建定义文件。
2. 在 `src/cases/index.ts` 的 `builtinBenchmarkCases` 注册一行。

case 禁止启动进程、访问数据库、实现评分器或复制执行流程。重复 ID、重复输入、未使用
的 prompt 输入会在 registry 创建时明确失败。Runner 的执行编排只存在于
`orchestration/runBenchmarkCase.ts`。

## 运行语义

一次 `run` 会：

1. 在任何 Agent 副作用前校验 case 与文件输入。
2. 调用真实 `linnya send`，记录 conversation/run/execution identity。
3. 用 `status --watch` 等待状态变化；只按 case 声明处理 `awaiting_user`。
4. 达到 case 超时时终止 exact root run，并等待真实 terminal settlement。
5. 收集 final result、消息数量摘要和 `audit` 安全执行摘要。
6. 原子写入 `facts.json` 与 `report.md`。

Runner 被手动关闭不会杀掉 App 所拥有的 run；可用报告/终端中的 ID 执行
`pnpm linnya:cli stop <conversation-id> --run <run-id>`。Runner 自己判定超时时则会自动
调用 stop，避免遗留后台任务。

## 报告

默认目录：

```text
_dev_data/benchmark-results/<case-id>/<timestamp>-r<revision>-<run-id>/
  facts.json
  report.md
```

`facts.json` 保存身份、配置、状态轨迹、wait_user 回应、终态、消息数量、错误和
`linnya audit` 的安全聚合。`audit` 的 Telemetry 部分固定标记为 `best_effort`；actual、
estimate、missing usage 分开统计，不用 0 补缺失。

`report.md` 把机器事实和人工审阅分开。自动部分包含管理层摘要、测试身份、阶段墙钟、
连续状态轨迹、审计来源完整度、父子 Run、模型与 token/cache 口径、工具 decision/output
配对完整度、Shell 命令终态、全部工具明细、
自动 context compaction 明细、每个 Run 的步数占用与终止原因、分层错误和 Conversation
消息投影。压缩报告按 run 分开展示全部观测、真实 Provider attempt、完成提交和附带 Provider actual
usage 的实际调用，并展示护栏、触发水位、前后 token、真实请求成本、耗时、cache read 与
失败结果。明细用 `generation_attempted` 区分真实请求与发送前结算；发送 Provider 前失败的结果仍属于观测，但不会计入 attempt 或 usage 缺失。`compactionIndex` 表示下一次 Provider attempt 的序号槽位，只有 `generation_attempted=true` 才真正消耗该槽位。报告不会把累计 LLM/工具耗时与墙钟机械相加，也不会把
cache token 占比冒充请求命中率。Canonical `input_tokens` 只表示非缓存输入；报告中的 Provider
总输入统一按 `input_tokens + cache_read + cache_write` 计算，cache token 占比也使用这份总输入作
分母。人工部分预留产物硬事实、逐页复核、质量维度和问题
分级。视觉质量、内容质量和预览/导出一致性必须由人填写，不输出自动总分，也不会自动
把一次结果提升为 baseline。

## 测试

```bash
pnpm typecheck:linnya-benchmark
pnpm test:linnya-benchmark
pnpm benchmark:agent list
```

测试分层：

- registry 测试：查询、排序、重复 ID 和声明合同。
- 输入测试：CLI 参数、必需输入、绝对文件路径和 prompt 插值。
- orchestration 集成测试：fake CLI port 穿过完整 send/watch/respond/timeout/stop/result/audit
  编排，不调用模型。
- 报告集成测试：真实临时文件，验证 facts 与待人工审阅报告同时写出。
- CLI 子进程测试：真实启动 Benchmark CLI，验证 `list` 与副作用前失败。
- 真实模型 Benchmark 不进入普通测试门禁，必须由开发者显式执行，避免产生费用和污染
  日常测试数据。

当前架构、运行语义与后续 baseline 约束以本文和相邻实现测试为准；新的重大设计通过公开 issue / PR 讨论后写回本文。
