# 画布排布计划

`backend/capabilities/canvasComputation` 的 `createCanvasComputationRuntime({workerPath})` 在一个有界 Node worker 中调用本 feature 的树、网格与 ELK 分层算法。`layout(request,signal)` 接收带提交序号的快照、范围、方向与位置/尺寸保护名单，返回只含位置修改的命令和诊断。每条修改携带原卡片 baseRevision；本 feature 不写数据库、不批准大改、不替调用方重试旧结果。调用方必须在正式共同提交入口重验版本、锁定和编辑保护。

宽高使用快照里正式测量后的尺寸事实，不按字数估算。未选中的卡、锁定卡和受保护卡作为障碍，排布只移动允许范围；整组避让既有障碍。显式 groups 分开排布并互相避让，不创建隐式分组身份。

树状排布用迭代遍历支持长链；环或多父节点选先到的父节点，其他线原样保留。网格按实际列宽/行高排布。ELK 只存在于 `adapters/elk`，选用 0.12.1 的 EPL-2.0 分支；不把它导入 Renderer 或 Backend 主线程。结果不包含换行、正文、颜色或连接关系修改。

Worker 组合 entry 为 `backend/orchestration/canvasComputationWorker.ts`，从本 feature 的独立 `worker.ts` 公共入口执行，构建成独立 Node CJS 闭包；最多一个运行任务和8个待办。AbortSignal 终止真实计算，销毁会拒绝所有剩余任务。共同提交的外部500条预算由调用方负责，不能偷偷拆批冒充原子排布。

验证：`canvasLayoutRuntime.integration.test.ts` 实际构建并启动 worker，覆盖三种算法的尺寸/范围/障碍、环、12000节点长链、取消后新快照。ELK 不用测试替身替换。
