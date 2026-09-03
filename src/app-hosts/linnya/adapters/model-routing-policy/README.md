# Model Routing Policy

这里是 Linnya Host 的 app-level 切模型决策边界。它只把 Host canonical inference 已归一的安全 failure code 投影为 Linnkit `switch_model/none` 建议。

## 职责

- `definitions/`：宿主路由策略的窄合同。
- `functions/`：读取 canonical failure code，并执行纯决策映射。
- `orchestration/`：装配默认策略，供 Graph runtime composition root 注入。

## 不负责

- 不解析 Provider response body、SDK error message 或 HTTP payload。
- 不改写 Provider request/response，continuation wire codec 属于 inference capability。
- 不选择具体 fallback model，不持有 Model Catalog，不管理 retry/attempt 预算。
- 不处理 Cloud quota 专用降级，该规则仍由 Linnkit 明确编排。

Provider 特定错误只能在 AI SDK 边界归一为无敏感信息的稳定 code；新规则必须先有 capability 集成测试和本模块决策测试。

可切模 code 必须从 inference adapter 的公开 `MODEL_ROUTABLE_INFERENCE_FAILURE_CODES` 合同导入。本模块不得复制字符串、deep import `failure-projection`，也不得因为新增 Provider SDK error shape 而修改。
