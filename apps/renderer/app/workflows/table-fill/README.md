# Table Fill Workflow

## 定位

本 workflow 是 Conversation、Editor 与系统专用 `subrun_batch` 的 app-level 编排边界。它把一次表格批量填充提交转换成一个父 run、N 个并发 child runs 和一个 Editor FIFO 写入 session。

它不拥有表格业务状态，不在 store 中执行异步流程，也不让 Conversation 知道 ProseMirror 坐标。

## 输入扩展

- Editor `table-ai-mode` 拥有模式会话、列引用解析/颜色和 active refs。
- 本 workflow 以 app-level Input Extension 把 `TableAiComposerContext` 与 `ColumnReferenceNode` 注册到 Conversation 通用 composer。
- 点击列标签只通过 composer port 插入 inline token；Conversation 不解析列坐标、颜色或表格 payload。
- 提交同步阶段先快照 active refs，宿主随后才清空 composer，避免引用上下文被提交时序提前清除。

## 数据流

1. Editor `table-fill-write` 按稳定 `rootBlockId` 构造全部行 prompt/context/目标坐标。
2. workflow 为每行生成独立 `unit_id/subrun_id`，映射为 `subrun_batch` 输入和 Editor write target。
3. workflow 准备本地 run 头但不发送 `persist_only`；同一个 messageId 由 forced-tool 请求一次性持久化并执行。
4. child `write_to_table` 的 live `subrun_trace` 经共享 schema 读取后进入 Editor FIFO port；工具提供的 `row/col` 不参与定位。工具成功后以 `finalAnswer=content` 结束当前 child，避免再次回 LLM 重复写入。

`write_to_table` 的工具贡献属于内建 Markdown domain（`src/domains/markdown/tools/write-to-table`），因为该结果只服务富文档 TableBlock。跨 child run 的单位映射、写入确认和失败聚合仍属于本 App workflow，不能下沉到工具或 Markdown 持久化层。
5. 父 `subrun_batch` output 到达时，所有 `completed` unit 必须至少已有一次成功本地写入，随后由无工具的 `system_batch_summarizer` 生成唯一 `final_answer`；普通 `default` Agent 不参与该系统批次收尾。
6. 成功、失败和取消均执行 `flush → endSession`；reload 只恢复历史展示，不调用本 workflow，因此不会重放写表副作用。

## 失败语义

- child 业务失败：保留在 batch partial 结果中，其他行继续。
- 同一 child 多次写入：按 trace 到达顺序全部进入 FIFO。
- 本地 PM 写入失败、非法 trace、completed unit 无写入：属于流程完整性失败，立即中断父 run，禁止生成虚假成功总结。
- 用户取消：保留已完成/在途事务，拒绝排队和后续写入，最终释放 session。

## 边界

- `index.ts` 只暴露 builtin 装配所需的 Input Extension factory、workflow factory 与稳定 extension id；批次计划、stream 合同和执行编排是 workflow 内部实现，其他 feature 不得跨层直引。
- `definitions/`：workflow 输入、依赖 port、batch 计划、展示模型与文案合同。
- `functions/`：身份映射、trace 解析、父结果完整性、工具卡展示投影与文案解析。
- `orchestration/`：执行时序、生产依赖组装与 feature 文案注册。
- `ui/`：输入上下文与 `write_to_table` 工具卡；工具卡由 always-enabled platform renderer contribution 注册，不依赖暂时停用的 Sheet 插件。
- Editor 独占表格模式状态与 PM 写入 session；Conversation 只提供通用 input-extension、消息投影和 tool-card 挂载点。
- 列引用高亮是 Editor `table-ai-mode` 内部直接能力，不通过 app workflow 或全局 event bus 转发。

工具输出中的可选 `row/col` 不是正式写回位置事实源，因此工具卡不展示该坐标。用户看到的行任务由父 batch 的 subrun header 表达，真实写回始终由 host 预绑定的 `unit_id` 映射决定。
