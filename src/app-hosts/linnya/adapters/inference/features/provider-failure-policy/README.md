# Host Provider Failure Policy

本 feature 拥有 Linnya 产品错误语义和正式连接范围内的容错政策。通用 SDK 错误分类属于
[adapter package](../../../../../../../packages/linnkit-provider-ai-sdk/src/features/failure-projection/README.md)，
等待、次数和取消属于 Linnkit caller；这里不增加重试循环或任务恢复器。

## 两个介入点

- `createLinnyaProviderFailureClassifier`：按本次 attempt 的正式连接身份绑定窄 classifier。
  只有 Go 识别缺少会话身份，只有 Linnya Cloud 识别产品额度拒绝；其它连接保留通用分类。
- `projectProviderFailurePolicy`：在 SDK 完成精确分类、Host 校验事件 route 后，对残余失败投影有效重试资格。
  正式连接身份来自现有 request identity，不进入 SDK，也不按模型名、URL 或 endpoint 前缀推断。

## 身份与并发边界

普通 Provider 从已提交配置归属解析 connection definition；Cloud 不一定存在普通配置行，
由 Model Catalog 中 `host_managed/linnya-cloud` 凭据引用确认身份。BYOK 的 endpoint、URL、
model 或 stored-secret 名字相同，不能因此被当作 Cloud。

Host 只解析一次 request identity，把其中的连接身份传给 Host capability composition。
composition 为每次调用创建仅捕获身份的 classifier 闭包，并通过 SDK 的 invocation 扩展点传入。
SDK 不接收产品连接字段，也不把 classifier 保存成共享 capability 的全局依赖；并发 Cloud、Go
及 Custom API 共用同一 codec 时不会串用规则。该改变不重建 capability，不重置其 trace 诊断计数。

HTTP 和已解码流各自保持原有可识别语义；非本产品的相同错误类型/文案不获得产品错误码。
classifier 只在当前内存调用中处理既有候选字段，不返回或记录 Provider 正文。

## 未知 HTTP400 试用

仅 `provider_connection_definition_id=opencode-go`、未取消且原失败为不可重试的
`provider/provider_http_400` 时，投影为 `retryable=true, retry_category=other`。
其他连接（包括同 URL、同模型的 Custom API）保持原样。明确的会话、容量、鉴权、额度或
不支持能力拒绝保留原分类，不能被本政策覆盖。

这是对原因未明拒绝的有限容忍，不证明它是网络故障或上游允许重试。部分真正的参数错误
也只有通用400，仍可能被重复发送。默认 caller 复用既有 other 预算：最多重试3次、每次
等待1.5秒，含首次最多4个 attempt。SDK仍为零重试；root/child 使用同一入口。
调用方禁用重试、取消和耗尽后暂停/继续的合同不变，详见
[产品行为入口](../../../../../../../docs/conversation-platform/13-retry-and-resumption.md)。

## 观察与回退

SDK `failure_projected` 保留原始分类。`recordProviderFailurePolicyApplication` 另外记录
`policy_applied`：只含政策身份、正式连接定义、attempt/trace、原分类及有效资格；不记录
错误正文、URL、请求内容或凭据。Host stream 审计、response 审计、outbound 终态和 caller
统一消费有效事件。UI按 other/HTTP400 展示，不能改称已确认网络异常。

真实使用按 LLM 调用与 attempt 分别观察：未知400次数、试探成功、耗尽暂停、额外usage及
缺失、人工恢复。离线夹具只能证明执行边界。上游提供稳定错误语义后优先收窄；若只增加
坏请求成本而不减少暂停，可撤回这一个连接政策，不修改通用分类或 caller。

## 业务回归

[`opencodeGoRetryPolicy.integration.test.ts`](../../__tests__/opencodeGoRetryPolicy.integration.test.ts)
通过真实 SDK、本地响应和默认 caller 验证次数/等待、身份隔离、明确拒绝优先、取消、
失败片段撤回及脱敏审计。原有 request identity、持久重试通知和恢复回归仍分别归各 owner。

[`providerFailureScope.integration.test.ts`](../../__tests__/providerFailureScope.integration.test.ts)
使用共享真实 SDK 的并发调用验证 Cloud/Go/Custom/缺归属的 HTTP 与流式隔离、Cloud宿管凭据身份，
以及同 URL、模型和 endpoint 名称不产生产品归属。
