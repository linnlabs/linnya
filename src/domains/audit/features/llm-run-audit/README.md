# LLM Run Audit

本 feature 负责开发环境中的 LLM run 本地审计。它只记录观测数据，不允许把审计上下文写入
模型供应商的请求体或请求头。

## 边界

- `definitions/`：审计上下文、记录条目、run bucket 与 checkpoint 状态契约。
- `functions/`：环境配置、容量限制、数据清洗/压缩、时间格式和审计文档投影。
- `persistence/`：审计目录解析、原子 JSON 写入和 checkpoint 文件清理。
- `orchestration/`：AsyncLocalStorage 生命周期、记录动作、checkpoint 调度与最终 flush。
- `index.ts`：生产调用方的唯一入口，并把 recorder 绑定到 linnkit。

## 写盘约定

- 仅在 `LINNYA_DEV_MODE=true` 且显式开启 `LINNYA_LLM_RUN_AUDIT` 时运行。
- 根 run 启动时立即写一份合法 `.in_progress.json`，后续按 500ms debounce / 2s 最大间隔增量更新。
- checkpoint 与最终文件都使用临时文件、同步和 rename 的原子替换流程。
- 最终 flush 成功后才删除 checkpoint。
- HTTP、SystemReminder 和工具协议错误继续按各自环境变量限制每个 run key 的保留数量。
- root 的 `before / after / system reminder` 用于检查 Context Manager；child 链路有意不记录这些大快照，只保留 transcript、HTTP、物化尝试和工具协议错误。
- 最终 JSON 不提供 `subruns` 或 `subrun_system_reminder_hits` lifecycle 字段。工具协议错误文件使用 `subrun_errors`，避免与 run 汇总混淆。

## Lifecycle 边界

本 feature 是开发环境的 LLM I/O 观测面，不是 run lifecycle owner。它不定义 status、
stepCount、起止时间或 parent lifecycle 查询，也不得从请求次数、transcript 长度推导 child
状态。需要 subrun lifecycle 汇总时，统一读取 `RunSupervisor.list({ parentRunId })` 背后的
RunRegistryStore。

业务调用方统一从 `src/domains/audit/features/llm-run-audit` 导入，禁止直接依赖内部目录。
