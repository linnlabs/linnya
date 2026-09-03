# Presentation build failure

该 feature 是 Slides 构建失败的唯一业务合同。它不执行编译，也不保存 draft；只定义稳定 code、phase、恢复策略和 write
observation 格式。

数据分两层：

- `PresentationBuildFailure`：typecheck、sandbox、compose、asset、PPTX 物化、persistence、environment 或 conflict 边界产生的稳定事实。
- `PresentationWriteFailure`：`CodegenPresentationService` 在写入边界补齐
  `draftSaved`、`presentationId` 和 expected revision。

`retryable=true/sourceFixable=false`
表示恢复运行环境后重试同一份 source，不能提示 Agent 随机改稿；`sourceFixable=true`
才允许建议修改 deck.js 或图片来源。`CodegenPresentationError.message`
只是这些结构化事实的模型可读投影，分类逻辑不得反向解析 message。

新增 code 时必须同时补策略表业务测试，并确认 write error、draft status 和 CLI
unresolved-draft 使用同一 code。内部 stack、绝对受管路径、数据库错误和原始存储异常不能进入 summary。

`slides.environment.build_executor_busy` 表示 Slides 自己的 build queue 已满；`slides.environment.build_executor_unavailable` 表示 Worker 启动、协议、超时或 crash 失败。二者都要求重试同一 source，不能提示 Agent 改稿，也不能静默切回 App Server 内执行。

compose 输入或 Flex 编译结果中的作者语义错误属于 `slides.codegen.compose_contract`，并应引导修正具体 deck.js 字段。已经生成的内部 DeckSpec 若在 Host 发送前被 materialization codec 拒绝，则属于 `slides.materialization.contract_invalid`：这是模块合同失配，不可重试，也不允许提示 Agent 随机改稿。`build_executor_unavailable` 只承接 Worker 启动、协议响应、超时或 crash。

公式失败直接复用 `shared/mathFormula` 的稳定 code，不从 message 猜分类。`invalid_source`、`unsupported_syntax`、资源预算、inline 宽度与精确行高问题允许 Agent 修正 source；`projection_failed` 与 `pptx_patch_failed` 表示引擎缺陷，不可通过改稿或盲目重试掩盖。公式领域失败只终止当前请求，不应终止健康的 build Worker。

PPTX 物化异常会在本次操作的公开 failure 中附带安全 `referenceId`，同时由 `SlidesCodegen`
logger 用相同 identity 记录 presentation/project、页数、layout 和完整内部 cause。`referenceId`
用于把安全输出与内部日志关联，不改变稳定 code，也不把内部 cause 持久化进 draft summary。
