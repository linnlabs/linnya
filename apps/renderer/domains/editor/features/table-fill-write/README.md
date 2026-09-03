# Table Fill Write

## 1. 模块定位

本 feature 是 Editor domain 对“表格批量填充写回”的唯一公开边界。它把并发 child runs 产生的声明式写入意图转换为串行 ProseMirror transaction，同时隐藏表格坐标、节点和 Editor 实例。

P3.5 已由 `app/workflows/table-fill` 把生产表格提交接到本 port；P4 已删除旧 `tableAssistantStore → rowExecutor → TableToolExecutor` 回退链，本 feature 现在是唯一生产写回边界。

## 2. 目录职责

- `definitions/tableFillWrite.ts`：跨域 port、Editor session-owner 和稳定 command DTO。
- `functions/buildTableFillRowPlans.ts`：请求前按稳定表身份读取一次最新表格，并构造全部行 prompt/context/写入坐标。
- `orchestration/createTableFillWriteRuntime.ts`：session 生命周期、FIFO 队列、取消和默认 runtime。
- `index.ts`：feature 唯一公开出口，只暴露 app workflow 构造行计划和驱动生产 session 所需的窄类型、函数与 port 实例。
- `__tests__/tableFillWriteRuntime.test.ts`：真实 ProseMirror transaction 与并发/取消合同。

底层复用：

- `TableBlock/ai/tableCellWriteOperation.ts`：按 `rootBlockId` 重定位、真实 cell write 和 append tracker。
- `TableBlock/ai/tableCellWriter.js`：最小 ProseMirror 单元格 transaction。
- `TableBlock/ai/tableOutputPlaceholders.ts`：写入前的 unit context 占位符替换。

runtime factory、占位符替换和上述 TableBlock 原子能力均是 Editor 内部实现，不能从公开入口反向透出。测试可直接验证内部 runtime，但不能据此扩大生产 public contract。

## 3. 两个边界

### 跨域 port

`TableFillWritePort` 只接收稳定业务身份和写入内容：

- `sessionId`
- `unitId`
- `content`
- `mode`

它不接受 `Editor`、ProseMirror node、`row/col`、`tablePos` 或 `rootBlockId`。conversation/app 编排不能绕过 unit 映射指定任意单元格。

### Editor session owner

`TableFillWriteSessionOwner.beginSession` 只允许 Editor 内部调用。它保存：

- Editor 实例。
- 表格稳定 `rootBlockId` 与初始位置快照。
- `unitId → rowIndex/colIndex/rowContext` 映射。
- session 级 append 状态和 AbortSignal。

`beginSession` 没有放进跨域 port。这是对早期路线图草案的边界校准：如果跨域调用方负责传 Editor 坐标，port 只是换了名字，并没有完成解耦。

## 4. 写入与队列语义

- 同一 session 的写入严格按入队顺序串行执行。
- 不同 session 各有独立队列、目标映射和 append tracker。
- 每次真正写入前都从最新 doc 按 `rootBlockId` 重定位 table；`initialPos` 只作无稳定身份场景之外的初始快照，本 feature 要求 rootBlockId 存在。
- 第一次 `replace` 覆盖目标 cell；同一逻辑 `row:col` 后续写入沿用旧链规则追加。显式 `append` 从第一次开始追加。
- 只有底层 transaction 真实 dispatch 成功后才推进 append tracker。
- 一个 unit 写入失败只拒绝该次 `enqueueWrite`，队列恢复后继续处理后续 unit。
- `flush` 等待当前已排队写入结束；`endSession` 停止接收新写入，排空队列并释放 session 映射。

## 5. 取消语义

- session AbortSignal 触发后立即进入 cancelled 状态。
- 已进入写入临界区的同步 ProseMirror transaction 保留，不尝试回滚。
- 已排队但尚未执行的写入以 `AbortError` 拒绝。
- 取消后的新写入同样以 `AbortError` 拒绝。
- `cancelSession` 等待在途与排队 operation 全部结算；最终资源释放仍由 `endSession` 负责。

这个规则与产品语义一致：取消保留已完成行，只阻止尚未开始的写入。撤销已插入输出列属于上层表格交互策略，不属于 write port。

## 6. 安全约束

- `unitId` 由 host 在 batch 发起前确定，child 的 `write_to_table.row/col` 不进入正式 port。
- session 内 unit ID 必须唯一，目标坐标必须是非负整数。
- 空 content 不进入写入队列；正式 `write_to_table` 本身也要求非空 content。
- reload 只恢复 tool/subrun 展示，不调用本 port，因此不会重复执行历史写入。

## 7. 验证范围

当前测试使用真实 ProseMirror schema 和 transaction，覆盖：

- 三个并发 enqueue 的 FIFO、replace/append 和占位符行为。
- 表格前插入新 rootBlock 后仍写入原目标表格。
- 单项越界失败后后续 unit 继续完成。
- AbortSignal 下在途保留、排队/后续拒绝。
- session 启动时拒绝重复 unit 身份。

生产链由 app workflow 消费 live subrun trace 并管理 session 生命周期；P3.6 已通过真实 Electron 验收取消、reload、续聊和长列表滚动。
