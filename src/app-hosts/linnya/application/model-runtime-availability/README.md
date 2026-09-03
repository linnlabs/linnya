# Model Runtime Availability

本 feature 组合 Model Catalog 的正式 route、Inference Endpoint 状态与 Provider Account 凭据状态，回答“一个已经物化的模型当前能否承担指定产品用途”。它不选择模型、不解析密钥，也不执行推理。

当前正式用途只有 `chat` 与 `image_generation`。`evaluateModelRuntimeAvailability()` 返回可用结论或稳定原因；Model Picker、Conversation CLI 的模型查询和 CLI 发送前接纳必须复用这一个判断，不能分别根据模型名、UI 显隐或某个 route 字段猜测。

模型配置存在不等于模型可运行。正式 route、对应能力与当前凭据缺一不可；`auth_profile=none` 的本地模型不要求凭据。Provider Account 的真实授权状态由 Host 注入，Model Catalog 不跨 domain 读取账号密钥。
