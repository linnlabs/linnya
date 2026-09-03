## Transaction（事务观测）README（当前实现）

> 中文说明：
> - 当前 transaction 子系统以“观测聚合”为主：把 command/operation/reflow 串成可追溯的 tx 记录。
> - 它不是独立业务系统，服务于 commands 的可观测与未来演进（例如 history 策略评审/回放/协同）。
>
> 最后更新：2026-02-04

---

## 1) 核心文件

- 类型：`domain/transaction/types.ts`
- TxRecorder：`domain/transaction/txRecorder.ts`
- Steps 记录：`domain/transaction/stepRecorder.ts`

---

## 2) 观测链路

- command runner 生成 txId，并注入 `operation.meta`
- ReflowScheduler flush 产出 `lifecycle:geometryFlushed`（带 reasons，并可关联 txId/txIds）
- TxRecorder 监听 operation + geometryFlushed，按 txId 聚合

