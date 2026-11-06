# 有界画布计算

`createCanvasComputationRuntime({workerPath})` 提供 `layout(request,signal)` 与 `check(snapshot,signal)`。能力只拥有 Node worker、1个运行任务/8个待办、严格数据边界、取消、30秒超时与销毁；不拥有排布规则、查询规则或文档提交。

执行组合入口为 `backend/orchestration/canvasComputationWorker.ts`，通过 feature 公共入口分派。ELK 只在 layout 分支动态加载，主 Backend 和 check 客户端不加载其执行模块。调用方负责读出授权范围的精确快照，提交排布时重新验证序号/元素修订和编辑保护；check 永远只读。

正常任务顺序复用一个计算线程，保留已加载的ELK；空闲unref，不阻止进程退出。取消、超时、协议异常或线程失败时终止旧线程，等终止完成才接纳下一任务。销毁会拒绝待办并终止运行/空闲线程。线程复用参考[Node Worker文档](https://nodejs.org/api/worker_threads.html)，不引入通用线程池依赖。不能在失败后悄悄同步计算或返回估算结果。

layout请求必须携带正式requestId。客户端将响应computation中的requestId、snapshot sequence及algorithm与在途请求核对后才接纳；executionMs由实际算法Worker填入，能力层不测含队列/IPC的总时长，也不为失败或取消造0ms记录。
